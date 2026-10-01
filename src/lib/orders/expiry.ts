import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { TX_OPTIONS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Hold-expiry sweep (02-database-schema.md v2.1 "Inventory reservation
// mechanics" — the spec's own SQL, verbatim semantics):
//
//   SELECT id FROM orders
//   WHERE status IN ('AWAITING_PAYMENT','PROOF_SUBMITTED','NEEDS_RESUBMIT')
//     AND hold_expires_at < now() AND NOT inventory_released
//   FOR UPDATE SKIP LOCKED;
//   -- for each: status='EXPIRED', inventory_released=true, and per line item
//   --            reserved -= quantity
//
// ONE transaction. Idempotent: after a successful pass the candidates
// disappear (status is now EXPIRED and inventory_released is true), so running
// it twice decrements reserved exactly once. SKIP LOCKED keeps concurrent
// sweeps (cron + lazy initialize) from double-processing the same order.
//
// Triggered by POST /api/internal/expire-holds (CRON_SECRET-guarded) AND
// lazily at the start of checkout/initialize (03) so availability is right
// even if the scheduler is late.
// ─────────────────────────────────────────────────────────────────────────────

export type SweepResult = {
  /** Orders transitioned to EXPIRED in this pass (0 on the idempotent re-run). */
  expired: number;
};

export async function expireHolds(): Promise<SweepResult> {
  return db.$transaction(async (tx) => {
    // Spec's candidate query + deterministic order. SKIP LOCKED: a concurrent
    // sweep (or an initialize-triggered lazy pass) simply skips rows the other
    // transaction is already expiring.
    const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM orders
      WHERE status IN ('AWAITING_PAYMENT', 'PROOF_SUBMITTED', 'NEEDS_RESUBMIT')
        AND hold_expires_at < now()
        AND NOT inventory_released
      ORDER BY id
      FOR UPDATE SKIP LOCKED
    `);

    if (candidates.length === 0) return { expired: 0 };
    // Lock tiers in one global order across the entire locked batch. Sorting
    // each order separately still permits a high-tier -> low-tier lock cycle.
    const tierAgg = await tx.$queryRaw<{ tier_id: string; total_qty: bigint }[]>(Prisma.sql`
      SELECT tier_id, SUM(quantity) AS total_qty
      FROM order_line_items
      WHERE order_id IN (${Prisma.join(candidates.map(({ id }) => Prisma.sql`${id}::uuid`))})
      GROUP BY tier_id
      ORDER BY tier_id
    `);
    for (const line of tierAgg) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE ticket_tiers
        SET reserved = reserved - ${Number(line.total_qty)}
        WHERE id = ${line.tier_id}::uuid
      `);
    }
    for (const { id } of candidates) {
      await tx.order.update({
        where: { id },
        data: { status: "EXPIRED", inventoryReleased: true },
      });
    }

    return { expired: candidates.length };
  }, TX_OPTIONS);
}
