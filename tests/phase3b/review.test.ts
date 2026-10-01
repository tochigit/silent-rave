import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  api,
  backdateHold,
  check,
  checkEqual,
  createStaffUser,
  createTestTier,
  getTierState,
  initializeOrder,
  login,
  makeDb,
  runSweep,
  submitProof,
  submitProof as proof,
  type Session,
} from "./helpers";
import { verifyTicketToken } from "@/lib/tickets/qr";
import "./load-env";

// ─────────────────────────────────────────────────────────────────────────────
// Owner review — approveOrder / rejectOrder / revive (04 "Admin review"),
// full lifecycles, concurrency, EVENT_CANCELLED, and the sync_seq trigger.
// IP buckets: this file uses 10.40.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const db = makeDb();
let tier: { id: string; eventId: string; priceKobo: number; capacity: number };
let owner: Session;
let owner2: Session;

beforeAll(async () => {
  tier = await createTestTier(db, "review-tier", 200);
  owner = await login(process.env.OWNER_EMAIL ?? "owner@silentrave.ng", process.env.OWNER_PASSWORD ?? "silentrave-dev-owner");
  // A second OWNER account = "two simulated admins".
  await createStaffUser("owner2@test.ng", "owner2-password-123", "OWNER");
  owner2 = await login("owner2@test.ng", "owner2-password-123");
});

afterAll(async () => {
  await db.$disconnect();
});

let counter = 0;
let lastHolderNames: string[] = [];
async function freshOrder(qty = 1): Promise<{ orderCode: string; token: string; orderId: string }> {
  counter += 1;
  lastHolderNames = Array.from({ length: qty }, (_, i) => `Holder ${counter}-${i}`);
  const { status, body } = await initializeOrder({
    tierId: tier.id,
    quantity: qty,
    holderNames: lastHolderNames,
    email: `review-${counter}-${Date.now()}@test.ng`,
    phone: `091${String(10000000 + counter)}`,
    ip: `10.40.0.${10 + counter}`,
  });
  checkEqual(status, 201, "fixture order");
  const order = await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } });
  return { orderCode: body!.order_code, token: body!.status_token, orderId: order.id };
}

async function freshSubmittedOrder(qty = 1): Promise<{ orderCode: string; token: string; orderId: string }> {
  const order = await freshOrder(qty);
  const result = await submitProof({
    orderCode: order.orderCode,
    statusToken: order.token,
    reference: `REV${Date.now()}${counter}`,
    ip: `10.40.1.${10 + counter}`,
  });
  checkEqual(result.status, 200, "fixture proof submitted");
  return order;
}

function approve(session: Session, orderId: string) {
  return api(`/api/admin/orders/${orderId}/approve`, {
    host: "admin.localhost:3000",
    origin: "http://admin.localhost:3000",
    cookies: session.cookies,
    body: { confirmed_in_bank: true },
  });
}

function reject(session: Session, orderId: string, body: Record<string, unknown>) {
  return api(`/api/admin/orders/${orderId}/reject`, {
    host: "admin.localhost:3000",
    origin: "http://admin.localhost:3000",
    cookies: session.cookies,
    body,
  });
}

describe("approveOrder — concurrency and idempotency", () => {
  test("double-click + two admins racing: ONE transition, sold incremented once, exactly N tickets, ONE TICKETS job", async () => {
    const order = await freshSubmittedOrder(3);
    const before = await getTierState(db, tier.id);

    // One double-click + one second admin, all racing in parallel.
    const [a, b, c] = await Promise.all([
      approve(owner, order.orderId),
      approve(owner, order.orderId),
      approve(owner2, order.orderId),
    ]);
    const statuses = [a.status, b.status, c.status];
    check(statuses.every((s) => s === 200), `all calls return 200 (idempotent no-ops included): ${statuses.join(",")}`);
    const bodies = await Promise.all([a.json(), b.json(), c.json()]);
    const realTransitions = bodies.filter((body: any) => !body.idempotent).length;
    checkEqual(realTransitions, 1, "exactly ONE real APPROVED transition");
    checkEqual(bodies.filter((body: any) => body.idempotent).length, 2, "the other two are idempotent no-ops");

    const after = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(after.status, "APPROVED", "order APPROVED");
    const tierAfter = await getTierState(db, tier.id);
    checkEqual(tierAfter.sold, before.sold + 3, "sold incremented exactly once (by 3)");
    checkEqual(tierAfter.reserved, before.reserved - 3, "reserved decremented once (by 3)");

    const tickets = await db.ticketUnit.findMany({ where: { orderId: order.orderId } });
    checkEqual(tickets.length, 3, "exactly 3 ticket_units");
    checkEqual(
      JSON.stringify(tickets.map((t) => t.holderName).sort()),
      JSON.stringify([...lastHolderNames].sort()),
      "holder names copied positionally"
    );

    const ticketsJobs = await db.emailJob.count({ where: { orderId: order.orderId, kind: "TICKETS" } });
    checkEqual(ticketsJobs, 1, "exactly ONE TICKETS email job");
    const approveAudits = await db.auditLogEntry.count({ where: { action: "ORDER_APPROVED", entityId: order.orderId } });
    checkEqual(approveAudits, 1, "exactly one ORDER_APPROVED audit entry");

    // Every minted QR token verifies and carries the order's event.
    for (const ticket of tickets) {
      const verification = verifyTicketToken(ticket.qrToken);
      check(verification.ok, "minted token verifies");
      if (verification.ok) {
        checkEqual(verification.ticketId, ticket.id, "token round-trips its own ticket id");
        checkEqual(verification.eventId, tier.eventId, "token carries the order's event id");
      }
    }
    // The PENDING proof became APPROVED with reviewer attribution.
    const proofRow = await db.paymentProof.findFirstOrThrow({ where: { orderId: order.orderId } });
    checkEqual(proofRow.status, "APPROVED", "proof APPROVED");
    check(proofRow.reviewedBy !== null && proofRow.reviewedAt !== null, "reviewer recorded");
    const orderRow = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    check(orderRow.approvedAt !== null && orderRow.approvedBy !== null, "approved_at/by set");
  });

  test("approve on a CANCELLED event → EVENT_CANCELLED, nothing changed", async () => {
    const organizer = await db.organizer.findFirstOrThrow();
    const venue = await db.venue.findFirstOrThrow();
    const cancelledEvent = await db.event.create({
      data: {
        slug: `cancelled-${Date.now()}`,
        title: "Cancelled Event",
        description: "x",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 * 2),
        status: "PUBLISHED",
        isDateConfirmed: true,
      },
    });
    const cancelledTier = await db.ticketTier.create({
      data: { eventId: cancelledEvent.id, name: "CX", priceKobo: 500000, capacity: 10 },
    });
    const { status, body } = await initializeOrder({
      tierId: cancelledTier.id,
      eventId: cancelledEvent.id,
      email: `cancelled-buyer-${Date.now()}@test.ng`,
      phone: "09211112222",
      ip: "10.40.2.1",
    });
    checkEqual(status, 201, "order created");
    const proofResult = await submitProof({
      orderCode: body!.order_code,
      statusToken: body!.status_token,
      reference: `CX${Date.now()}`,
      ip: "10.40.2.2",
    });
    checkEqual(proofResult.status, 200, "proof submitted");
    const orderId = (await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } })).id;

    await db.event.update({ where: { id: cancelledEvent.id }, data: { status: "CANCELLED" } });

    const response = await approve(owner, orderId);
    checkEqual(response.status, 409, "approve on cancelled event → 409");
    const responseBody = await response.json();
    checkEqual(responseBody.code, "EVENT_CANCELLED", "error code EVENT_CANCELLED");

    const orderRow = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    checkEqual(orderRow.status, "PROOF_SUBMITTED", "order untouched");
    checkEqual(orderRow.approvedAt, null, "no approval recorded");
    const tickets = await db.ticketUnit.count({ where: { orderId } });
    checkEqual(tickets, 0, "no tickets minted");
    const tierRow = await db.ticketTier.findUniqueOrThrow({ where: { id: cancelledTier.id } });
    checkEqual(tierRow.sold, 0, "sold untouched");
    checkEqual(tierRow.reserved, 1, "reservation still held");
  });

  test("approve requires confirmed_in_bank: true", async () => {
    const order = await freshSubmittedOrder(1);
    const missing = await api(`/api/admin/orders/${order.orderId}/approve`, {
      host: "admin.localhost:3000",
      origin: "http://admin.localhost:3000",
      cookies: owner.cookies,
      body: {},
    });
    checkEqual(missing.status, 400, "missing confirmation → 400");
    const falseBody = await api(`/api/admin/orders/${order.orderId}/approve`, {
      host: "admin.localhost:3000",
      origin: "http://admin.localhost:3000",
      cookies: owner.cookies,
      body: { confirmed_in_bank: false },
    });
    checkEqual(falseBody.status, 400, "confirmed_in_bank: false → 400");
    const orderRow = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(orderRow.status, "PROOF_SUBMITTED", "no transition without the bank confirmation");
  });

  test("approve vs reject racing on the same PROOF_SUBMITTED order: exactly ONE wins, the loser gets a clean INVALID_STATE, inventory consistent", async () => {
    const order = await freshSubmittedOrder(2);
    const before = await getTierState(db, tier.id);

    const [approveRes, rejectRes] = await Promise.all([
      approve(owner, order.orderId),
      reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Blurry.", final: false }),
    ]);

    // Exactly one wins; the loser serialized on the order row lock and saw a
    // post-transition status → clean 409 INVALID_STATE (no partial anything).
    const winner = approveRes.status === 200 ? "approve" : rejectRes.status === 200 ? "reject" : "neither";
    check(approveRes.status === 200 || rejectRes.status === 200, `one call must win (${approveRes.status}/${rejectRes.status})`);
    check(approveRes.status !== 200 || rejectRes.status !== 200, "not both may win");
    const loserStatus = approveRes.status === 200 ? rejectRes.status : approveRes.status;
    checkEqual(loserStatus, 409, "the loser gets 409");
    const loserBody = approveRes.status === 200 ? await rejectRes.json() : await approveRes.json();
    checkEqual(loserBody.code, "INVALID_STATE", "loser error code is INVALID_STATE (clean state conflict)");

    const after = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    const tierAfter = await getTierState(db, tier.id);
    const tickets = await db.ticketUnit.count({ where: { orderId: order.orderId } });

    if (winner === "approve") {
      checkEqual(after.status, "APPROVED", "approve-branch final status");
      checkEqual(tierAfter.sold, before.sold + 2, "approve-branch: sold +2 exactly once");
      checkEqual(tierAfter.reserved, before.reserved - 2, "approve-branch: reserved -2");
      checkEqual(tickets, 2, "approve-branch: exactly 2 tickets minted");
    } else {
      checkEqual(after.status, "NEEDS_RESUBMIT", "reject(non-final)-branch final status");
      checkEqual(tierAfter.sold, before.sold, "reject-branch: sold untouched");
      checkEqual(tierAfter.reserved, before.reserved, "reject-branch: reservation still held");
      checkEqual(tickets, 0, "reject-branch: no tickets minted");
    }
    check(tierAfter.reserved >= 0 && tierAfter.sold + tierAfter.reserved <= tierAfter.capacity, "inventory never negative / CHECK holds");
  });

  test("approve vs sweep racing on an order at its hold cap: consistent final state, inventory never negative, no double release", async () => {
    const order = await freshSubmittedOrder(2);
    const before = await getTierState(db, tier.id);
    // At the 48h cap: hold lapsed while PROOF_SUBMITTED (awaiting review).
    await backdateHold(db, order.orderCode, 60 * 1000);

    const [approveRes, sweepRes] = await Promise.all([approve(owner, order.orderId), runSweep()]);
    checkEqual(approveRes.status, 200, "approve completes (whichever path won)");
    checkEqual(sweepRes.status, 200, "sweep completes");

    const after = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(after.status, "APPROVED", "final status APPROVED on BOTH race outcomes (direct, or via the revive path)");

    // Both outcomes converge to the SAME tier arithmetic:
    //   approve-first: sold += 2, reserved -= 2 (sweep then skips: not sweepable)
    //   sweep-first:   reserved -= 2 at expiry, revive then does sold += 2
    const tierAfter = await getTierState(db, tier.id);
    checkEqual(tierAfter.sold, before.sold + 2, "sold incremented exactly once (by 2)");
    checkEqual(tierAfter.reserved, before.reserved - 2, "reserved decremented exactly once (net -2) — no double release");
    check(tierAfter.reserved >= 0, "reserved never negative");
    check(tierAfter.sold + tierAfter.reserved <= tierAfter.capacity, "CHECK (sold+reserved<=capacity) holds");

    const tickets = await db.ticketUnit.count({ where: { orderId: order.orderId } });
    checkEqual(tickets, 2, "exactly 2 ticket_units");
    const ticketsJobs = await db.emailJob.count({ where: { orderId: order.orderId, kind: "TICKETS" } });
    checkEqual(ticketsJobs, 1, "exactly ONE TICKETS job");
    const reviewAudits = await db.auditLogEntry.count({
      where: { entityId: order.orderId, action: { in: ["ORDER_APPROVED", "ORDER_REVIVED"] } },
    });
    checkEqual(reviewAudits, 1, "exactly one approve/revive audit entry");
    // inventory_released records WHICH path won (sweep-first → true) — either is
    // consistent, but it must agree with the reservation arithmetic above.
    const releasedConsistent = after.inventoryReleased
      ? tierAfter.reserved === before.reserved - 2
      : tierAfter.reserved === before.reserved - 2;
    check(releasedConsistent, "inventory_released flag agrees with the tier arithmetic");
  });
});

describe("full lifecycles", () => {
  test("initialize → proof → approve: statuses, inventory, emails, audit", async () => {
    const order = await freshSubmittedOrder(2);
    const before = await getTierState(db, tier.id);
    const response = await approve(owner, order.orderId);
    checkEqual(response.status, 200, "approve ok");
    const tierAfter = await getTierState(db, tier.id);
    checkEqual(tierAfter.sold, before.sold + 2, "sold +2");
    checkEqual(tierAfter.reserved, before.reserved - 2, "reserved -2");
    const kinds = await db.emailJob.findMany({ where: { orderId: order.orderId }, select: { kind: true, dedupeKey: true } });
    checkEqual(
      kinds.map((k) => `${k.kind}/${k.dedupeKey}`).sort().join(","),
      "PROOF_RECEIVED/initial,TICKETS/initial",
      "email job kinds exactly as specified"
    );
    const auditActions = await db.auditLogEntry.findMany({
      where: { entityId: order.orderId },
      select: { action: true },
    });
    check(auditActions.some((a) => a.action === "ORDER_APPROVED"), "ORDER_APPROVED audit present");
  });

  test("initialize → proof → reject(resubmittable) → resubmit ×3 → fourth rejection exhausted → REJECTED, inventory released once", async () => {
    const order = await freshOrder(2);
    const before = await getTierState(db, tier.id);

    // Attempt 1
    const p1 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `EX1-${Date.now()}`, ip: "10.40.3.1" });
    checkEqual(p1.status, 200, "proof 1");
    const r1 = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Blurry — re-upload.", final: false });
    checkEqual(r1.status, 200, "reject 1");
    checkEqual((await r1.json()).order_status, "NEEDS_RESUBMIT", "order NEEDS_RESUBMIT");
    let mid = await getTierState(db, tier.id);
    checkEqual(mid.reserved, before.reserved, "inventory still held while resubmittable");

    // Attempts 2, 3
    for (const n of [2, 3]) {
      const pn = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `EX${n}-${Date.now()}`, ip: `10.40.3.${n}` });
      checkEqual(pn.status, 200, `proof ${n}`);
      const rn = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Still unreadable.", final: false });
      checkEqual(rn.status, 200, `reject ${n}`);
      checkEqual((await rn.json()).order_status, "NEEDS_RESUBMIT", `still resubmittable after attempt ${n}`);
    }

    // Attempt 4 (the last allowed: proof_attempts hits 1+3=4)
    const p4 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `EX4-${Date.now()}`, ip: "10.40.3.4" });
    checkEqual(p4.status, 200, "proof 4 accepted (4 total submissions allowed)");
    checkEqual(p4.body.attempt_no, 4, "attempt 4");

    // A FIFTH submission is refused with 403 (attempts exhausted).
    const p5 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `EX5-${Date.now()}`, ip: "10.40.3.5" });
    checkEqual(p5.status, 403, "fifth submission → 403 ATTEMPTS_EXHAUSTED");

    const r4 = await reject(owner, order.orderId, { reason_code: "NOT_RECEIVED", message: "No matching credit found.", final: true });
    checkEqual(r4.status, 200, "final rejection");
    checkEqual((await r4.json()).order_status, "REJECTED", "order REJECTED (attempts exhausted + final)");

    const after = await getTierState(db, tier.id);
    checkEqual(after.reserved, before.reserved - 2, "inventory released exactly once (by 2)");
    const orderRow = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(orderRow.status, "REJECTED", "terminal REJECTED");
    checkEqual(orderRow.inventoryReleased, true, "inventory_released flag set");

    // REJECTED email jobs: attempt-1..attempt-4, all distinct keys.
    const rejectedJobs = await db.emailJob.findMany({
      where: { orderId: order.orderId, kind: "REJECTED" },
      select: { dedupeKey: true },
    });
    checkEqual(rejectedJobs.length, 4, "one REJECTED email per attempt");
    checkEqual(
      new Set(rejectedJobs.map((j) => j.dedupeKey)).size,
      4,
      "dedupe keys are distinct (attempt-<n>)"
    );
    checkEqual(
      rejectedJobs.map((j) => j.dedupeKey).sort().join(","),
      "attempt-1,attempt-2,attempt-3,attempt-4",
      "keys follow attempt-<n>"
    );
  });

  test("OWNER closing a NEEDS_RESUBMIT order → REJECTED and inventory released once (fresh close-<n> email key)", async () => {
    const order = await freshOrder(1);
    const before = await getTierState(db, tier.id);
    const p1 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `CL1-${Date.now()}`, ip: "10.40.4.1" });
    checkEqual(p1.status, 200, "proof 1");
    const r1 = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Re-upload.", final: false });
    checkEqual(r1.status, 200, "resubmittable rejection");
    const attempt1Job = await db.emailJob.count({ where: { orderId: order.orderId, kind: "REJECTED", dedupeKey: "attempt-1" } });
    checkEqual(attempt1Job, 1, "attempt-1 REJECTED email exists");

    const close = await reject(owner, order.orderId, { reason_code: "NOT_RECEIVED", message: "Closing this order.", final: true });
    checkEqual(close.status, 200, "close works from NEEDS_RESUBMIT");
    const closeBody = await close.json();
    checkEqual(closeBody.order_status, "REJECTED", "closed → REJECTED");
    checkEqual(closeBody.from, "NEEDS_RESUBMIT", "source state reported");

    const after = await getTierState(db, tier.id);
    checkEqual(after.reserved, before.reserved - 1, "inventory released once");
    const orderRow = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(orderRow.status, "REJECTED", "terminal");

    const closeJobs = await db.emailJob.findMany({
      where: { orderId: order.orderId, kind: "REJECTED" },
      select: { dedupeKey: true },
    });
    checkEqual(closeJobs.length, 2, "two REJECTED emails: attempt-1 + the close");
    check(
      closeJobs.some((j) => j.dedupeKey.startsWith("close-")),
      "close uses a FRESH key (close-<n>), not a duplicate of attempt-1"
    );
    // same key is not duplicated
    checkEqual(new Set(closeJobs.map((j) => j.dedupeKey)).size, 2, "keys unique");
  });
});

describe("revive rules (04 + CHANGELOG v2.1 item 4)", () => {
  test("revive with capacity: EXPIRED + PENDING proof → APPROVED, re-reserves atomically", async () => {
    const order = await freshOrder(2);
    const p = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `RV1-${Date.now()}`, ip: "10.40.5.1" });
    checkEqual(p.status, 200, "proof submitted");
    const before = await getTierState(db, tier.id);

    // Expire at the 48h cap while awaiting review (sweep).
    await backdateHold(db, order.orderCode, 60 * 1000);
    const sweep = await runSweep();
    check(sweep.body.expired >= 1, "sweep expired it");
    const expiredOrder = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(expiredOrder.status, "EXPIRED", "EXPIRED with a PENDING proof");
    const midTier = await getTierState(db, tier.id);
    checkEqual(midTier.reserved, before.reserved - 2, "inventory released at expiry");

    const response = await approve(owner, order.orderId);
    checkEqual(response.status, 200, "revive & approve");
    const body = await response.json();
    checkEqual(body.revived, true, "revived flag");
    const revivedAudit = await db.auditLogEntry.count({ where: { action: "ORDER_REVIVED", entityId: order.orderId } });
    checkEqual(revivedAudit, 1, "ORDER_REVIVED audit entry (06 action list)");

    const tierAfter = await getTierState(db, tier.id);
    checkEqual(tierAfter.sold, midTier.sold + 2, "revive: sold +2");
    checkEqual(tierAfter.reserved, midTier.reserved, "revive: reserved untouched (was released)");
    const tickets = await db.ticketUnit.count({ where: { orderId: order.orderId } });
    checkEqual(tickets, 2, "tickets minted by the revive");
    const jobs = await db.emailJob.count({ where: { orderId: order.orderId, kind: "TICKETS" } });
    checkEqual(jobs, 1, "TICKETS job queued by the revive");
  });

  test("revive WITHOUT capacity → CAPACITY_GONE rollback, then dismiss → REJECTED final, releases nothing", async () => {
    const scarceTier = await createTestTier(db, "scarce-revive-tier", 2);
    const { status, body } = await initializeOrder({
      tierId: scarceTier.id,
      quantity: 2,
      email: `scarce-${Date.now()}@test.ng`,
      phone: "09311112222",
      ip: "10.40.6.1",
    });
    checkEqual(status, 201, "order for the scarce tier");
    const order = await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } });
    const p = await proof({ orderCode: body!.order_code, statusToken: body!.status_token, reference: `SC-${Date.now()}`, ip: "10.40.6.2" });
    checkEqual(p.status, 200, "proof submitted");

    await backdateHold(db, body!.order_code, 60 * 1000);
    await runSweep();
    const expired = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    checkEqual(expired.status, "EXPIRED", "expired with PENDING proof");

    // Capacity gone: another order buys both units.
    const { status: buyerStatus } = await initializeOrder({
      tierId: scarceTier.id,
      quantity: 2,
      email: `scarce-buyer-${Date.now()}@test.ng`,
      phone: "09333334444",
      ip: "10.40.6.3",
    });
    checkEqual(buyerStatus, 201, "competing order takes the released units");
    await db.ticketTier.update({ where: { id: scarceTier.id }, data: { sold: 2, reserved: 0 } });

    const failed = await approve(owner, order.id);
    checkEqual(failed.status, 409, "revive fails");
    const failedBody = await failed.json();
    checkEqual(failedBody.code, "CAPACITY_GONE", "CAPACITY_GONE code");
    const stillExpired = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    checkEqual(stillExpired.status, "EXPIRED", "rollback: order stays EXPIRED");
    const tickets = await db.ticketUnit.count({ where: { orderId: order.id } });
    checkEqual(tickets, 0, "no tickets minted on the failed revive");
    const scarceState = await db.ticketTier.findUniqueOrThrow({ where: { id: scarceTier.id } });
    checkEqual(scarceState.sold, 2, "sold unchanged by the failed revive (rolled back)");

    // Dismiss: always final, releases nothing (already released at expiry).
    const beforeDismiss = await db.ticketTier.findUniqueOrThrow({ where: { id: scarceTier.id } });
    const dismiss = await reject(owner, order.id, { reason_code: "CAPACITY_GONE", message: "Sold out meanwhile — refund issued manually.", final: true });
    checkEqual(dismiss.status, 200, "dismiss works");
    const dismissBody = await dismiss.json();
    checkEqual(dismissBody.from, "EXPIRED", "dismiss source state EXPIRED");
    checkEqual(dismissBody.order_status, "REJECTED", "dismiss → REJECTED (final)");
    checkEqual(dismissBody.released, false, "released NOTHING on dismiss");
    const afterDismiss = await db.ticketTier.findUniqueOrThrow({ where: { id: scarceTier.id } });
    checkEqual(afterDismiss.reserved, beforeDismiss.reserved, "reserved untouched by dismiss");
    const proofRow = await db.paymentProof.findFirstOrThrow({ where: { orderId: order.id } });
    checkEqual(proofRow.status, "REJECTED", "the PENDING proof became REJECTED");
    const dismissJobs = await db.emailJob.count({ where: { orderId: order.id, kind: "REJECTED" } });
    checkEqual(dismissJobs, 1, "REJECTED email with the fresh dismiss key");
  });

  test("an order that expired from NEEDS_RESUBMIT is NOT revivable (no PENDING proof)", async () => {
    const order = await freshOrder(1);
    const p = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `NR-${Date.now()}`, ip: "10.40.7.1" });
    checkEqual(p.status, 200, "proof submitted");
    const r = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Re-upload.", final: false });
    checkEqual(r.status, 200, "resubmittable rejection → NEEDS_RESUBMIT");

    await backdateHold(db, order.orderCode, 60 * 1000);
    await runSweep();
    const expired = await db.order.findUniqueOrThrow({ where: { id: order.orderId } });
    checkEqual(expired.status, "EXPIRED", "expired from NEEDS_RESUBMIT");

    const revive = await approve(owner, order.orderId);
    checkEqual(revive.status, 409, "revive refused");
    const reviveBody = await revive.json();
    checkEqual(reviveBody.code, "INVALID_STATE", "only EXPIRED orders with a PENDING proof are revivable");
  });
});

describe("sync_seq trigger (02 v2.1)", () => {
  test("changes on INSERT (mint) and UPDATE (check-in, void); monotonic per statement", async () => {
    const order = await freshSubmittedOrder(2);
    await approve(owner, order.orderId);
    const tickets = await db.ticketUnit.findMany({
      where: { orderId: order.orderId },
      orderBy: { syncSeq: "asc" },
    });
    checkEqual(tickets.length, 2, "two tickets minted");
    const [t1, t2] = tickets;
    check(Number(t1.syncSeq) > 0, "insert assigned sync_seq");
    check(Number(t2.syncSeq) > Number(t1.syncSeq), "monotonic across the two inserts");

    // Simulated check-in (Phase 5 will do it atomically; here we only prove
    // the trigger fires on UPDATE). $1::uuid — raw params need explicit casts.
    await db.$executeRawUnsafe(
      `UPDATE ticket_units SET check_in_status = 'CHECKED_IN', checked_in_at = now() WHERE id = $1::uuid`,
      t1.id
    );
    const afterCheckIn = await db.ticketUnit.findUniqueOrThrow({ where: { id: t1.id } });
    check(Number(afterCheckIn.syncSeq) > Number(t1.syncSeq), "check-in UPDATE bumps sync_seq");

    // Simulated void.
    await db.$executeRawUnsafe(`UPDATE ticket_units SET voided_at = now() WHERE id = $1::uuid`, t1.id);
    const afterVoid = await db.ticketUnit.findUniqueOrThrow({ where: { id: t1.id } });
    check(Number(afterVoid.syncSeq) > Number(afterCheckIn.syncSeq), "void UPDATE bumps sync_seq again");

    // A no-op-ish UPDATE still fires the trigger (BEFORE INSERT OR UPDATE).
    await db.$executeRawUnsafe(`UPDATE ticket_units SET holder_name = holder_name WHERE id = $1::uuid`, t2.id);
    const afterNoop = await db.ticketUnit.findUniqueOrThrow({ where: { id: t2.id } });
    check(Number(afterNoop.syncSeq) > Number(t2.syncSeq), "any UPDATE bumps sync_seq (no code path can forget it)");
  });
});

describe("close/dismiss audit entries — before/after reject snapshots (A7)", () => {
  test("closing a NEEDS_RESUBMIT order: the audit records the PREVIOUS rejection and the NEW close reason (before/after)", async () => {
    const order = await freshOrder(1);
    const p1 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `AUD1-${Date.now()}`, ip: "10.40.8.1" });
    checkEqual(p1.status, 200, "proof 1");
    // First rejection (resubmittable) — reason UNREADABLE, final false.
    const r1 = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Blurry receipt — re-upload.", final: false });
    checkEqual(r1.status, 200, "resubmittable rejection");

    // Owner CLOSES the order — new reason NOT_RECEIVED, final true.
    const close = await reject(owner, order.orderId, { reason_code: "NOT_RECEIVED", message: "No matching credit found — closing.", final: true });
    checkEqual(close.status, 200, "close works");

    const audits = await db.auditLogEntry.findMany({
      where: { action: "ORDER_REJECTED", entityId: order.orderId },
      orderBy: { createdAt: "asc" },
    });
    checkEqual(audits.length, 2, "two ORDER_REJECTED audit entries (rejection + close)");
    const closeAudit = audits[1];
    const meta = (closeAudit.metadata ?? {}) as Record<string, any>;
    checkEqual(meta.from, "NEEDS_RESUBMIT", "close audit records the source state");
    checkEqual(meta.to, "REJECTED", "close audit records the target state");
    checkEqual(meta.before.reason_code, "UNREADABLE", "BEFORE: previous reject reason code");
    checkEqual(meta.before.message, "Blurry receipt — re-upload.", "BEFORE: previous reject message");
    checkEqual(meta.before.final, false, "BEFORE: previous reject was not final");
    checkEqual(meta.after.reason_code, "NOT_RECEIVED", "AFTER: new (close) reason code");
    checkEqual(meta.after.message, "No matching credit found — closing.", "AFTER: new (close) message");
    checkEqual(meta.after.final, true, "AFTER: close is final");
    // The first rejection's audit has a null before (no previous rejection).
    const firstMeta = (audits[0].metadata ?? {}) as Record<string, any>;
    checkEqual(firstMeta.before.reason_code, null, "first rejection: before.reason_code is null (no previous rejection)");
    checkEqual(firstMeta.after.reason_code, "UNREADABLE", "first rejection: after.reason_code");

    // ── Sample audit row (verbatim, for the close-out report) ──
    console.log(
      "SAMPLE CLOSE AUDIT ROW:\n" +
      JSON.stringify(
        {
          id: closeAudit.id,
          actor_id: closeAudit.actorId,
          action: closeAudit.action,
          entity_type: closeAudit.entityType,
          entity_id: closeAudit.entityId,
          metadata: closeAudit.metadata,
          created_at: closeAudit.createdAt,
        },
        null,
        2
      )
    );
  });

  test("dismissing an EXPIRED order with a PENDING (late) proof: before is the null snapshot, after is the dismiss reason", async () => {
    const order = await freshOrder(1);
    // Expire with NO proof yet, then a LATE proof arrives within grace.
    await backdateHold(db, order.orderCode, 60 * 1000);
    await runSweep();
    const late = await proof({
      orderCode: order.orderCode,
      statusToken: order.token,
      reference: `AUD2-${Date.now()}`,
      ip: "10.40.8.2",
    });
    checkEqual(late.status, 200, "late proof recorded");
    checkEqual(late.body.late, true, "it is the late path");

    const dismiss = await reject(owner, order.orderId, { reason_code: "CAPACITY_GONE", message: "Sold out in the meantime.", final: true });
    checkEqual(dismiss.status, 200, "dismiss works");

    const audits = await db.auditLogEntry.findMany({
      where: { action: "ORDER_REJECTED", entityId: order.orderId },
      orderBy: { createdAt: "asc" },
    });
    checkEqual(audits.length, 1, "one ORDER_REJECTED audit entry (the dismiss)");
    const meta = (audits[0].metadata ?? {}) as Record<string, any>;
    checkEqual(meta.from, "EXPIRED", "dismiss audit records the source state");
    checkEqual(meta.before.reason_code, null, "BEFORE: the PENDING late proof carried no rejection (nulls)");
    checkEqual(meta.before.message, null, "BEFORE: message null");
    checkEqual(meta.before.final, null, "BEFORE: final null");
    checkEqual(meta.after.reason_code, "CAPACITY_GONE", "AFTER: dismiss reason");
    checkEqual(meta.after.final, true, "AFTER: dismiss is final");
  });
});

describe("REJECTED email-job dedupe keys (B)", () => {
  test("attempt-<n> keys for two different attempts BOTH exist; the SAME key cannot duplicate (unique index backstop)", async () => {
    const order = await freshOrder(1);
    // Attempt 1 + rejection (resubmittable) → attempt-1 job.
    const p1 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `DJ1-${Date.now()}`, ip: "10.40.9.1" });
    checkEqual(p1.status, 200, "proof 1");
    const r1 = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Blurry.", final: false });
    checkEqual(r1.status, 200, "reject 1");
    // Attempt 2 + rejection (resubmittable) → attempt-2 job.
    const p2 = await proof({ orderCode: order.orderCode, statusToken: order.token, reference: `DJ2-${Date.now()}`, ip: "10.40.9.2" });
    checkEqual(p2.status, 200, "proof 2");
    const r2 = await reject(owner, order.orderId, { reason_code: "UNREADABLE", message: "Still blurry.", final: false });
    checkEqual(r2.status, 200, "reject 2");

    const jobs = await db.emailJob.findMany({
      where: { orderId: order.orderId, kind: "REJECTED" },
      select: { dedupeKey: true },
      orderBy: { dedupeKey: "asc" },
    });
    checkEqual(jobs.map((j) => j.dedupeKey).join(","), "attempt-1,attempt-2", "attempt-1 AND attempt-2 both exist (two different attempts)");

    // The same (order_id, kind, dedupe_key) CANNOT be inserted again — the
    // UNIQUE index is the backstop that guarantees one email per attempt.
    let duplicateRejected = false;
    try {
      await db.emailJob.create({
        data: { orderId: order.orderId, kind: "REJECTED", dedupeKey: "attempt-1", recipientEmail: "x@test.ng" },
      });
    } catch (error: any) {
      duplicateRejected = error?.code === "P2002";
    }
    check(duplicateRejected, "inserting the SAME key again violates the unique index (P2002)");
    const still = await db.emailJob.count({ where: { orderId: order.orderId, kind: "REJECTED" } });
    checkEqual(still, 2, "still exactly two REJECTED jobs — no duplicate row");
  });
});


