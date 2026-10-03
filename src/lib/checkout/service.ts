import { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import {
  MAX_QTY_PER_ORDER,
  MAX_UNRESOLVED_ORDERS_PER_EMAIL,
  MAX_UNRESOLVED_ORDERS_PER_PHONE,
  ORDER_CODE_ALPHABET,
  ORDER_CODE_LENGTH,
  ORDER_CODE_PREFIX,
  PROOF_SUBMIT_WINDOW_MS,
  TX_OPTIONS,
} from "@/lib/constants";
import { OrderServiceError } from "@/lib/orders/errors";
import { deriveStatusToken } from "@/lib/orders/status-token";
import { expireHolds } from "@/lib/orders/expiry";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/checkout/initialize — service layer (03-api-routes.md v2.1
// "Public — Checkout"; 02 "Inventory reservation mechanics"; 04 buyer flow).
//
// Money is confirmed by a human checking the bank account — this route only
// creates the order, soft-reserves inventory and tells the buyer where to pay.
//
// Invariants:
//   • Prices NEVER come from the client — total_kobo is computed from
//     ticket_tiers.price_kobo re-read INSIDE the reservation transaction
//     (RETURNING price_kobo on the locked row).
//   • Reservation = one atomic conditional UPDATE per tier (raw SQL — ORM
//     `where` cannot express capacity - sold - reserved >= n); the affected-
//     row count is checked. Any failing line rolls back the whole
//     transaction → 409, NOTHING partially reserved.
//   • hold_expires_at = now + PROOF_SUBMIT_WINDOW (15 min).
//   • The ACTIVE payment account is snapshotted onto the order so the account
//     the buyer was told to pay stays traceable after a later change (04).
//     No active account → 503 before anything is reserved.
//   • Abuse limits: max 2 unresolved orders per email AND per phone (04).
//     IP is a RATE limit only (shared campus NAT) — enforced in the route.
//   • The lazy expiry sweep runs first (03: availability is right even if the
//     scheduler is late).
//   • order_code: "SR-" + 6 chars from an unambiguous alphabet (no 0/O/1/I),
//     non-sequential. Collision → the unique index rejects; we retry with a
//     fresh code (bounded attempts). Status token is DERIVED per 02 v2.1 —
//     nothing token-related is stored except the version.
// ─────────────────────────────────────────────────────────────────────────────

export type InitializeLineInput = {
  tierId: string;
  quantity: number;
  holderNames?: string[];
};

export type InitializeInput = {
  eventId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  lineItems: InitializeLineInput[];
};

export type InitializeResult = {
  orderCode: string;
  statusToken: string;
  amountKobo: number;
  holdExpiresAt: Date;
  paymentAccount: { bankName: string; accountNumber: string; accountName: string };
};

// 31^6 ≈ 887M codes — three attempts on collision is generous headroom.
const ORDER_CODE_ATTEMPTS = 3;

function generateOrderCode(): string {
  let code = "";
  for (let i = 0; i < ORDER_CODE_LENGTH; i++) {
    code += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  }
  return `${ORDER_CODE_PREFIX}${code}`;
}

/** Pre-tx semantic validation: event purchasability + tier windows/belonging. */
async function validatePurchasability(input: InitializeInput) {
  const event = await db.event.findUnique({
    where: { id: input.eventId },
    select: { id: true, status: true, isDateConfirmed: true, startsAt: true, endsAt: true },
  });
  if (!event) throw new OrderServiceError("NOT_FOUND", "Event not found.");
  if (event.status !== "PUBLISHED" || !event.isDateConfirmed) {
    // 03 v2.1 validation list: event PUBLISHED and is_date_confirmed.
    throw new OrderServiceError("INVALID_STATE", "This event is not open for ticket sales.", {
      status: event.status,
      is_date_confirmed: event.isDateConfirmed,
    });
  }
  // 03 v2.1.1: the event must NOT have ended (ends_at > now()). Without this a
  // past, date-confirmed event with an open sales window stayed purchasable
  // (v2.1.1 CHANGELOG item 1 — the only code change this patch set requires).
  // NOTE: an event IN PROGRESS (starts_at past, ends_at future) is allowed.
  if (event.endsAt.getTime() <= Date.now()) {
    throw new OrderServiceError("INVALID_STATE", "This event has already ended.", {
      ended_at: event.endsAt.toISOString(),
    });
  }

  const tierIds = [...new Set(input.lineItems.map((line) => line.tierId))];
  const tiers = await db.ticketTier.findMany({
    where: { id: { in: tierIds } },
    select: { id: true, eventId: true, salesStartAt: true, salesEndAt: true, name: true },
  });
  const byId = new Map(tiers.map((tier) => [tier.id, tier]));
  const now = new Date();
  const totalQuantity = input.lineItems.reduce((total, line) => total + line.quantity, 0);
  if (!Number.isInteger(totalQuantity) || totalQuantity < 1 || totalQuantity > MAX_QTY_PER_ORDER) {
    throw new OrderServiceError("VALIDATION", `An order must contain between 1 and ${MAX_QTY_PER_ORDER} tickets.`);
  }
  for (const line of input.lineItems) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY_PER_ORDER) {
      throw new OrderServiceError("VALIDATION", `Quantity must be between 1 and ${MAX_QTY_PER_ORDER}.`, {
        tier_id: line.tierId,
      });
    }
    if (line.holderNames !== undefined) {
      if (!Array.isArray(line.holderNames) || line.holderNames.length !== line.quantity) {
        throw new OrderServiceError("VALIDATION", "holder_names length must equal quantity (or be omitted).", {
          tier_id: line.tierId,
        });
      }
    }
    const tier = byId.get(line.tierId);
    if (!tier || tier.eventId !== input.eventId) {
      throw new OrderServiceError("VALIDATION", "Tier does not belong to this event.", {
        tier_id: line.tierId,
      });
    }
    if (tier.salesStartAt && tier.salesStartAt > now) {
      throw new OrderServiceError("INVALID_STATE", `Sales for ${tier.name} have not opened yet.`);
    }
    if (tier.salesEndAt && tier.salesEndAt < now) {
      throw new OrderServiceError("INVALID_STATE", `Sales for ${tier.name} have closed.`);
    }
  }
}

export async function initializeCheckout(input: InitializeInput): Promise<InitializeResult> {
  // Lazy expiry sweep — best-effort: a sweep failure must not block checkout
  // (the cron path remains the authoritative scheduler; tier conditional
  // UPDATEs below still guarantee correctness without it).
  try {
    await expireHolds();
  } catch (error) {
    console.error("[checkout] lazy expiry sweep failed (continuing):", error);
  }

  await validatePurchasability(input);

  // Snapshot the ACTIVE payment account BEFORE reserving (04: the account the
  // buyer is told to pay is traceable after later account changes). No active
  // account → clear 503, nothing reserved.
  const activeAccount = await db.paymentAccount.findFirst({
    where: { isActive: true },
    select: { id: true, bankName: true, accountNumber: true, accountName: true },
  });
  if (!activeAccount) {
    throw new OrderServiceError(
      "NO_PAYMENT_ACCOUNT",
      "No active payment account is configured — checkout is unavailable."
    );
  }

  // Aggregate per tier (duplicate tier lines sum) + canonical tier-id order —
  // every tier-locking path in the codebase locks tiers in this order, which
  // is what prevents deadlocks between concurrent checkouts/sweeps/approvals.
  const perTier = new Map<string, number>();
  for (const line of input.lineItems) {
    perTier.set(line.tierId, (perTier.get(line.tierId) ?? 0) + line.quantity);
  }
  const tierIdsOrdered = [...perTier.keys()].sort();

  let lastCollision: unknown = null;
  for (let attempt = 1; attempt <= ORDER_CODE_ATTEMPTS; attempt++) {
    const orderCode = generateOrderCode();

    try {
      return await db.$transaction(
        async (tx): Promise<InitializeResult> => {
          // 0. Abuse-cap serialization (close-out fix A6): transaction-scoped
          //    advisory locks on the normalized (lowercased) email AND phone,
          //    taken BEFORE the tier reservation UPDATEs and BEFORE counting.
          //    Concurrent same-email (or same-phone) checkouts now serialize:
          //    the second transaction's COUNT sees the first's committed rows,
          // so the 2-unresolved cap can no longer be exceeded by a race.
          //    New checkouts acquire email, phone, then sorted tier rows.
          //    Separate advisory namespaces prevent cross-category hash
          //    collisions from reversing the email/phone lock order. Within
          //    one namespace, collisions only serialize unrelated buyers.
          //    Existing-order writers lock their order before sorted tiers;
          //    this transaction inserts a new order and waits on no old order.
          //    NOTE: $executeRaw, not $queryRaw — pg_advisory_xact_lock returns
          //    void and $queryRaw cannot deserialize a void column (P2010).
          await tx.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(1, hashtext(lower(${input.customerEmail})))
          `);
          await tx.$executeRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(2, hashtext(lower(${input.customerPhone})))
          `);

          // 1. Atomic conditional reservation per tier + fresh server-side
          //    price on the same locked row. 0 rows → insufficient inventory
          //    for that line → rollback → 409 (nothing partially reserved).
          const prices = new Map<string, number>();
          for (const tierId of tierIdsOrdered) {
            const qty = perTier.get(tierId)!;
            const rows = await tx.$queryRaw<{ price_kobo: number }[]>(Prisma.sql`
              UPDATE ticket_tiers
              SET reserved = reserved + ${qty}
              WHERE id = ${tierId}::uuid AND (capacity - sold - reserved) >= ${qty}
              RETURNING price_kobo
            `);
            if (rows.length === 0) {
              throw new OrderServiceError(
                "INSUFFICIENT_INVENTORY",
                "Some tickets in this order just sold out — nothing was reserved.",
                { tier_id: tierId }
              );
            }
            prices.set(tierId, rows[0].price_kobo);
          }

          // 2. Abuse caps — counted inside the tx, under the advisory locks
          //    above, on the SAME normalization domain the locks guard
          //    (lower(email)/lower(phone); the route's zod already lowercases
          //    the email, the DB stores it lowercase — lower() on both sides
          //    makes the guarded domain exact).
          for (const [field, value, limit, label] of [
            ["customer_email", input.customerEmail, MAX_UNRESOLVED_ORDERS_PER_EMAIL, "email"],
            ["customer_phone", input.customerPhone, MAX_UNRESOLVED_ORDERS_PER_PHONE, "phone"],
          ] as const) {
            const rows = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
              SELECT COUNT(*) AS count FROM orders
              WHERE lower(${field === "customer_email" ? Prisma.sql`customer_email` : Prisma.sql`customer_phone`}) = lower(${value})
                AND status IN ('AWAITING_PAYMENT', 'PROOF_SUBMITTED', 'NEEDS_RESUBMIT')
            `);
            if (Number(rows[0].count) >= limit) {
              throw new OrderServiceError(
                "TOO_MANY_UNRESOLVED",
                `You already have ${limit} unresolved orders for this ${label}. Complete or wait for them to expire first.`
              );
            }
          }

          // 3. Order + line items with the price snapshot. status_token_version
          //    defaults to 1 — the token itself is DERIVED, never stored.
          const holdExpiresAt = new Date(Date.now() + PROOF_SUBMIT_WINDOW_MS);
          const totalKobo = input.lineItems.reduce(
            (sum, line) => sum + prices.get(line.tierId)! * line.quantity,
            0
          );

          const order = await tx.order.create({
            data: {
              orderCode,
              statusTokenVersion: 1,
              eventId: input.eventId,
              customerName: input.customerName,
              customerEmail: input.customerEmail,
              customerPhone: input.customerPhone,
              totalKobo,
              status: "AWAITING_PAYMENT",
              source: "ONLINE",
              paymentAccountId: activeAccount.id,
              paymentAccountSnapshot: { bank_name: activeAccount.bankName, account_number: activeAccount.accountNumber, account_name: activeAccount.accountName },
              holdExpiresAt,
              firstProofAt: null,
              proofAttempts: 0,
            },
            select: { id: true },
          });

          for (const line of input.lineItems) {
            await tx.orderLineItem.create({
              data: {
                orderId: order.id,
                tierId: line.tierId,
                quantity: line.quantity,
                unitPriceKobo: prices.get(line.tierId)!,
                holderNames: (line.holderNames ?? undefined) as Prisma.InputJsonValue | undefined,
              },
            });
          }

          // Derived per 02 v2.1 — recomputable by anyone holding the secret;
          // nothing token-related persisted except the version.
          const statusToken = deriveStatusToken(order.id, 1);

          return {
            orderCode,
            statusToken,
            amountKobo: totalKobo,
            holdExpiresAt,
            paymentAccount: {
              bankName: activeAccount.bankName,
              accountNumber: activeAccount.accountNumber,
              accountName: activeAccount.accountName,
            },
          };
        },
        TX_OPTIONS
      );
    } catch (error) {
      // order_code unique-index collision → retry with a fresh code.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const metaTarget = (error.meta?.target as string[] | string | undefined) ?? [];
        const collided =
          typeof metaTarget === "string"
            ? metaTarget.includes("order_code")
            : metaTarget.some((t) => t === "orderCode" || t === "order_code");
        if (collided && attempt < ORDER_CODE_ATTEMPTS) {
          lastCollision = error;
          continue;
        }
      }
      throw error;
    }
  }

  // Unreachable in practice: 31^6 space, three attempts.
  throw new OrderServiceError("VALIDATION", "Could not allocate an order code (collision).", {
    last_collision: String(lastCollision),
  });
}
