import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { emitServerEvent } from "@/lib/events/emitter";
import { signTicketToken } from "@/lib/tickets/qr";
import { MAX_PROOF_SUBMISSIONS, TX_OPTIONS } from "@/lib/constants";
import { OrderServiceError } from "./errors";

// ─────────────────────────────────────────────────────────────────────────────
// Owner review actions — approveOrder / rejectOrder (04-manual-payment.md,
// "Admin review"), including the revive path for EXPIRED-with-PENDING-proof
// orders and the three reject source states from v2.1 (CHANGELOG item 2).
//
// Structure (04's approveOrder pseudocode, exactly):
//   1. ONE short interactive transaction:
//        SELECT ... FROM orders WHERE id = :id FOR UPDATE     (row lock)
//        status = APPROVED        → return existing result (idempotent no-op)
//        status = PROOF_SUBMITTED → normal path
//        status = EXPIRED + PENDING proof → revive path (atomic re-reserve;
//                                       any tier lacking capacity → rollback
//                                       → CAPACITY_GONE)
//        any other status         → clear error
//        event CANCELLED          → EVENT_CANCELLED — checked AFTER the lock,
//                                   BEFORE any inventory change
//   2. per line item: sold += n, reserved -= n   (revive: reserved untouched,
//        sold += n guarded by capacity - sold - reserved >= n instead)
//   3. mint ticket_units — one per ticket, signed qr_token (pure computation,
//        no I/O — safe inside the txn), copy holder_names; sync_seq comes from
//        the BEFORE INSERT trigger (never written by code)
//   4. order: APPROVED + approved_at + approved_by; the PENDING proof:
//        APPROVED (+ reviewed_by/at)
//   5. email_jobs (kind TICKETS, dedupe 'initial') — unique index backstops
//   6. audit_log_entries (ORDER_APPROVED / ORDER_REVIVED on the revive path)
//   7. COMMIT — then (outside the txn) emit the realtime event.
//
// NO external I/O inside the transaction: storage, HTTP and notifications all
// happen before/after. Two admins tapping approve at once (or a double-click)
// serialize on the row lock: the second sees APPROVED and no-ops, so exactly
// one transition, one set of ticket_units, one email job.
// ─────────────────────────────────────────────────────────────────────────────

export type ApproveResult = {
  ok: true;
  /** true when the call found the order already APPROVED (idempotent no-op). */
  idempotent: boolean;
  /** true when this was the EXPIRED → APPROVED revive path. */
  revived: boolean;
  ticketCount: number;
};

export type RejectSource = "PROOF_SUBMITTED" | "NEEDS_RESUBMIT" | "EXPIRED";

export type RejectResult = {
  ok: true;
  from: RejectSource;
  /** resulting order status: NEEDS_RESUBMIT (resubmittable) or REJECTED. */
  orderStatus: "NEEDS_RESUBMIT" | "REJECTED";
  /** inventory released by THIS call (false when already released / dismiss). */
  released: boolean;
  emailDedupeKey: string;
};

// ── shared helpers ───────────────────────────────────────────────────────────

/** Per-tier aggregated quantities for an order, canonical tier-id order. */
async function tierQuantitiesForOrder(tx: Prisma.TransactionClient, orderId: string) {
  return tx.$queryRaw<{ tier_id: string; total_qty: bigint }[]>(Prisma.sql`
    SELECT tier_id, SUM(quantity) AS total_qty
    FROM order_line_items
    WHERE order_id = ${orderId}::uuid
    GROUP BY tier_id
    ORDER BY tier_id
  `);
}

/**
 * Release an order's reserved inventory (idempotent by the inventory_released
 * flag — callers only invoke it when the flag is still false). Single txn
 * context, canonical tier order. CHECK (reserved >= 0) is the DB backstop.
 */
async function releaseReservedInventory(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const lines = await tierQuantitiesForOrder(tx, orderId);
  for (const line of lines) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE ticket_tiers
      SET reserved = reserved - ${Number(line.total_qty)}
      WHERE id = ${line.tier_id}::uuid
    `);
  }
  await tx.order.update({
    where: { id: orderId },
    data: { inventoryReleased: true },
  });
}

type LockedOrder = {
  id: string;
  status: string;
  event_id: string;
  customer_email: string;
  proof_attempts: number;
  inventory_released: boolean;
};

/** Lock one order row FOR UPDATE inside tx; throws NOT_FOUND when missing. */
async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<LockedOrder> {
  const rows = await tx.$queryRaw<LockedOrder[]>(Prisma.sql`
    SELECT id, status::text AS status, event_id::text AS event_id,
           customer_email, proof_attempts, inventory_released
    FROM orders
    WHERE id = ${orderId}::uuid
    FOR UPDATE
  `);
  const order = rows[0];
  if (!order) throw new OrderServiceError("NOT_FOUND", "Order not found.");
  return order;
}

/** Mint one ticket_unit via raw SQL so the sync_seq trigger fires (02 v2.1). */
async function mintTicket(
  tx: Prisma.TransactionClient,
  params: { orderId: string; eventId: string; tierId: string; holderName: string | null }
): Promise<void> {
  const ticketId = randomUUID();
  const qrToken = signTicketToken(ticketId, params.eventId); // pure computation — no I/O
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ticket_units (id, order_id, event_id, tier_id, holder_name, qr_token)
    VALUES (${ticketId}::uuid, ${params.orderId}::uuid, ${params.eventId}::uuid,
            ${params.tierId}::uuid, ${params.holderName}, ${qrToken})
  `);
}

// ── approveOrder ─────────────────────────────────────────────────────────────

export async function approveOrder(orderId: string, actorId: string): Promise<ApproveResult> {
  const result = await db.$transaction(
    async (tx): Promise<ApproveResult> => {
      const order = await lockOrder(tx, orderId);

      // Idempotent no-op: already APPROVED → return existing result.
      if (order.status === "APPROVED") {
        const ticketCount = await tx.ticketUnit.count({ where: { orderId } });
        return { ok: true, idempotent: true, revived: false, ticketCount };
      }

      const revived = order.status === "EXPIRED";

      if (order.status !== "PROOF_SUBMITTED" && order.status !== "EXPIRED") {
        throw new OrderServiceError(
          "INVALID_STATE",
          `Cannot approve an order in status ${order.status}.`,
          { from: order.status }
        );
      }

      if (revived) {
        // Revive requires a PENDING proof (04: orders that expired from
        // NEEDS_RESUBMIT have none and are NOT revivable).
        const pendingProof = await tx.paymentProof.findFirst({
          where: { orderId, status: "PENDING" },
          select: { id: true },
        });
        if (!pendingProof) {
          throw new OrderServiceError(
            "INVALID_STATE",
            "Only an expired order with a PENDING proof is revivable.",
            { from: order.status }
          );
        }
      }

      // Event CANCELLED — AFTER the lock, BEFORE any inventory change (04).
      const event = await tx.event.findUnique({
        where: { id: order.event_id },
        select: { status: true, title: true },
      });
      if (!event) throw new OrderServiceError("NOT_FOUND", "Event not found.");
      if (event.status === "CANCELLED") {
        throw new OrderServiceError("EVENT_CANCELLED", "The event was cancelled.", {
          event_id: order.event_id,
        });
      }

      const lineItems = await tx.orderLineItem.findMany({
        where: { orderId },
        orderBy: { tierId: "asc" }, // canonical tier order (deadlock avoidance)
      });

      if (!revived) {
        // Normal path: sold += n, reserved -= n per line item. The row lock on
        // the order serializes concurrent approvals; reserved is guaranteed to
        // cover these lines while the order holds them (inventory_released false).
        for (const item of lineItems) {
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE ticket_tiers
            SET sold = sold + ${item.quantity}, reserved = reserved - ${item.quantity}
            WHERE id = ${item.tierId}::uuid AND reserved >= ${item.quantity}
          `);
          if (updated === 0) {
            // Should be unreachable for a locked PROOF_SUBMITTED order holding
            // its reservation; the tier CHECKs are the DB backstop. Surface as
            // INVALID_STATE rather than corrupting counters.
            throw new OrderServiceError(
              "INVALID_STATE",
              "Reserved inventory does not cover this order's line items.",
              { tier_id: item.tierId }
            );
          }
        }
      } else {
        // Revive path: inventory was already released at expiry — reserved is
        // untouched; sold += n guarded by remaining capacity. ANY failing tier
        // rolls back the whole transaction → CAPACITY_GONE (04).
        for (const item of lineItems) {
          const updated = await tx.$executeRaw(Prisma.sql`
            UPDATE ticket_tiers
            SET sold = sold + ${item.quantity}
            WHERE id = ${item.tierId}::uuid AND (capacity - sold - reserved) >= ${item.quantity}
          `);
          if (updated === 0) {
            throw new OrderServiceError(
              "CAPACITY_GONE",
              "A tier on this order no longer has capacity — the order cannot be revived. " +
                "Release it (dismiss) and refund the buyer manually.",
              { tier_id: item.tierId }
            );
          }
        }
      }

      // Mint ticket_units — one per ticket, holder_names copied positionally.
      for (const item of lineItems) {
        const holderNames = Array.isArray(item.holderNames)
          ? (item.holderNames as unknown[])
          : null;
        for (let i = 0; i < item.quantity; i++) {
          const holderName =
            holderNames && typeof holderNames[i] === "string" ? (holderNames[i] as string) : null;
          await mintTicket(tx, {
            orderId,
            eventId: order.event_id,
            tierId: item.tierId,
            holderName,
          });
        }
      }

      const now = new Date();
      await tx.order.update({
        where: { id: orderId },
        data: { status: "APPROVED", approvedAt: now, approvedBy: actorId },
      });
      // The PENDING proof becomes APPROVED (normal AND revive paths).
      await tx.paymentProof.updateMany({
        where: { orderId, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: actorId, reviewedAt: now },
      });

      // Exactly one TICKETS email job (dedupe 'initial'); the UNIQUE
      // (order_id, kind, dedupe_key) index is the race backstop.
      await tx.emailJob.create({
        data: { orderId, kind: "TICKETS", dedupeKey: "initial", recipientEmail: order.customer_email },
      });

      await writeAudit(tx, {
        actorId,
        action: revived ? "ORDER_REVIVED" : "ORDER_APPROVED",
        entityType: "order",
        entityId: orderId,
        metadata: { event_id: order.event_id, revived },
      });

      const ticketCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);
      return { ok: true, idempotent: false, revived, ticketCount };
    },
    TX_OPTIONS
  );

  // After commit: realtime event (IDs only). Never inside the transaction.
  emitServerEvent("order.approved", orderId);
  return result;
}

// ── rejectOrder ──────────────────────────────────────────────────────────────

export async function rejectOrder(
  orderId: string,
  actorId: string,
  input: { reasonCode: string; message: string; final: boolean }
): Promise<RejectResult> {
  const result = await db.$transaction(
    async (tx): Promise<RejectResult> => {
      const order = await lockOrder(tx, orderId);
      const now = new Date();

      switch (order.status as RejectSource) {
        case "PROOF_SUBMITTED": {
          // Its PENDING proof becomes REJECTED with the owner's reason. There is
          // no PREVIOUS rejection on this proof yet — the audit's `before`
          // snapshot records the nulls explicitly (uniform shape).
          const pendingProof = await tx.paymentProof.findFirst({
            where: { orderId, status: "PENDING" },
            select: { id: true, rejectReasonCode: true, rejectMessage: true, rejectFinal: true },
          });
          if (!pendingProof) {
            throw new OrderServiceError("INVALID_STATE", "No PENDING proof on this order.");
          }
          const before = rejectSnapshotOf(pendingProof);
          await tx.paymentProof.update({
            where: { id: pendingProof.id },
            data: {
              status: "REJECTED",
              rejectReasonCode: input.reasonCode,
              rejectMessage: input.message,
              rejectFinal: input.final,
              reviewedBy: actorId,
              reviewedAt: now,
            },
          });

          // Resubmittable AND attempts remain (02 v2.1: attempts "remain" while
          // proof_attempts < 1 + MAX_RESUBMISSIONS).
          const resubmittable = !input.final && order.proof_attempts < MAX_PROOF_SUBMISSIONS;
          const dedupeKey = `attempt-${order.proof_attempts}`;

          if (resubmittable) {
            // Inventory stays reserved — the buyer may re-upload.
            await tx.order.update({
              where: { id: orderId },
              data: { status: "NEEDS_RESUBMIT" },
            });
            await enqueueRejectedEmail(tx, orderId, order.customer_email, dedupeKey, input, true);
            await auditReject(tx, actorId, orderId, order.status, input, "NEEDS_RESUBMIT", before);
            return { ok: true, from: "PROOF_SUBMITTED", orderStatus: "NEEDS_RESUBMIT", released: false, emailDedupeKey: dedupeKey };
          }

          // Final: REJECTED + inventory released in the same transaction.
          await tx.order.update({
            where: { id: orderId },
            data: { status: "REJECTED" },
          });
          if (!order.inventory_released) {
            await releaseReservedInventory(tx, orderId);
          }
          await enqueueRejectedEmail(tx, orderId, order.customer_email, dedupeKey, input, false);
          await auditReject(tx, actorId, orderId, order.status, input, "REJECTED", before);
          return { ok: true, from: "PROOF_SUBMITTED", orderStatus: "REJECTED", released: !order.inventory_released, emailDedupeKey: dedupeKey };
        }

        case "NEEDS_RESUBMIT": {
          // Owner CLOSES the order → REJECTED (final). Releases inventory if
          // not already released. Fresh dedupe key (attempt-<n> may already
          // exist from the resubmittable rejection that put us here).
          const dedupeKey = `close-${order.proof_attempts}`;

          // Record the closing decision on the latest proof (the buyer's
          // status page shows the latest reject reason; the audit log keeps
          // the full history of BOTH decisions — close-out fix A7: the entry
          // records the PREVIOUS reject reason/message/final and the NEW ones
          // as an explicit before/after pair).
          const latestProof = await tx.paymentProof.findFirst({
            where: { orderId },
            orderBy: { attemptNo: "desc" },
            select: { id: true, rejectReasonCode: true, rejectMessage: true, rejectFinal: true },
          });
          const before = latestProof ? rejectSnapshotOf(latestProof) : null;
          if (latestProof) {
            await tx.paymentProof.update({
              where: { id: latestProof.id },
              data: {
                rejectReasonCode: input.reasonCode,
                rejectMessage: input.message,
                rejectFinal: true,
                reviewedBy: actorId,
                reviewedAt: now,
              },
            });
          }

          await tx.order.update({ where: { id: orderId }, data: { status: "REJECTED" } });
          let released = false;
          if (!order.inventory_released) {
            await releaseReservedInventory(tx, orderId);
            released = true;
          }
          await enqueueRejectedEmail(tx, orderId, order.customer_email, dedupeKey, input, false);
          await auditReject(tx, actorId, orderId, order.status, input, "REJECTED", before);
          return { ok: true, from: "NEEDS_RESUBMIT", orderStatus: "REJECTED", released, emailDedupeKey: dedupeKey };
        }

        case "EXPIRED": {
          // Dismiss an expired order that has a PENDING proof → REJECTED,
          // always final, releases NOTHING (inventory was released at expiry).
          // A PENDING proof carries no previous rejection — the audit's
          // `before` snapshot records the nulls explicitly.
          const pendingProof = await tx.paymentProof.findFirst({
            where: { orderId, status: "PENDING" },
            select: { id: true, rejectReasonCode: true, rejectMessage: true, rejectFinal: true },
          });
          if (!pendingProof) {
            throw new OrderServiceError(
              "INVALID_STATE",
              "Only an expired order WITH a pending proof can be dismissed.",
              { from: order.status }
            );
          }
          const dedupeKey = `dismiss-${order.proof_attempts}`;
          const before = rejectSnapshotOf(pendingProof);

          await tx.paymentProof.update({
            where: { id: pendingProof.id },
            data: {
              status: "REJECTED",
              rejectReasonCode: input.reasonCode,
              rejectMessage: input.message,
              rejectFinal: true,
              reviewedBy: actorId,
              reviewedAt: now,
            },
          });
          await tx.order.update({
            where: { id: orderId },
            data: { status: "REJECTED" },
          });
          await enqueueRejectedEmail(tx, orderId, order.customer_email, dedupeKey, input, false);
          await auditReject(tx, actorId, orderId, order.status, input, "REJECTED", before);
          return { ok: true, from: "EXPIRED", orderStatus: "REJECTED", released: false, emailDedupeKey: dedupeKey };
        }

        default:
          throw new OrderServiceError(
            "INVALID_STATE",
            `Cannot reject an order in status ${order.status}.`,
            { from: order.status }
          );
      }
    },
    TX_OPTIONS
  );

  emitServerEvent("order.rejected", orderId);
  return result;
}

/** The reject fields of a proof row, as they stood BEFORE a decision (A7). */
type RejectSnapshot = { reason_code: string | null; message: string | null; final: boolean | null };

function rejectSnapshotOf(proof: {
  rejectReasonCode: string | null;
  rejectMessage: string | null;
  rejectFinal: boolean | null;
}): RejectSnapshot {
  return {
    reason_code: proof.rejectReasonCode,
    message: proof.rejectMessage,
    final: proof.rejectFinal,
  };
}

async function enqueueRejectedEmail(
  tx: Prisma.TransactionClient,
  orderId: string,
  recipientEmail: string,
  dedupeKey: string,
  input: { reasonCode: string; message: string; final: boolean },
  resubmittable: boolean
): Promise<void> {
  await tx.emailJob.create({
    data: {
      orderId,
      kind: "REJECTED",
      dedupeKey,
      recipientEmail,
    },
  });
}

async function auditReject(
  tx: Prisma.TransactionClient,
  actorId: string,
  orderId: string,
  fromStatus: string,
  input: { reasonCode: string; message: string; final: boolean },
  toStatus: string,
  before: RejectSnapshot | null
): Promise<void> {
  await writeAudit(tx, {
    actorId,
    action: "ORDER_REJECTED",
    entityType: "order",
    entityId: orderId,
    // Close-out fix A7: every reject audit entry now carries an explicit
    // BEFORE (the reject reason/message/final the proof carried when the
    // decision started — nulls when there was no previous rejection) and
    // AFTER (the decision being applied) snapshot.
    metadata: {
      from: fromStatus,
      to: toStatus,
      before,
      after: { reason_code: input.reasonCode, message: input.message, final: input.final },
    },
  });
}
