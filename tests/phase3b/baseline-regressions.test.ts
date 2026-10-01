import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  api, backdateHold, createTestTier, getFixtureEvent, getTierState,
  initializeOrder, login, makeDb, runSweep, submitProof, type Session,
} from "./helpers";

const db = makeDb();
let owner: Session;
beforeAll(async () => { owner = await login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!); });
afterAll(async () => { await db.$disconnect(); });

describe("Imported baseline regressions", () => {
  test("MAX_QTY_PER_ORDER applies to the whole order across multiple lines", async () => {
    const tier = await createTestTier(db, "baseline-total-quantity", 30);
    const response = await api("/api/checkout/initialize", {
      ip: "10.80.0.4", body: {
        event_id: tier.eventId, customer_name: "Quantity Test",
        customer_email: "quantity@test.ng", customer_phone: "08012345679",
        line_items: [{ tier_id: tier.id, quantity: 6 }, { tier_id: tier.id, quantity: 5 }],
      },
    });
    expect(response.status).toBe(400);
    expect(await getTierState(db, tier.id)).toMatchObject({ sold: 0, reserved: 0 });
    expect(await db.order.count({ where: { customerEmail: "quantity@test.ng" } })).toBe(0);
  });

  test("revive respects another buyer's reservation and returns CAPACITY_GONE without side effects", async () => {
    const tier = await createTestTier(db, "baseline-revive", 2);
    const expired = await initializeOrder({ tierId: tier.id, quantity: 1, ip: "10.80.0.1" });
    expect(expired.status).toBe(201);
    const order = await db.order.findUniqueOrThrow({ where: { orderCode: expired.body!.order_code } });
    await backdateHold(db, order.orderCode, 60_000);
    await runSweep();
    const late = await submitProof({
      orderCode: order.orderCode, statusToken: expired.body!.status_token,
      reference: `BASELINE-REVIVE-${order.id}`, ip: "10.80.0.2",
    });
    expect(late.status).toBe(200);
    const active = await initializeOrder({ tierId: tier.id, quantity: 2, ip: "10.80.0.3" });
    expect(active.status).toBe(201);
    const response = await api(`/api/admin/orders/${order.id}/approve`, {
      cookies: owner.cookies, host: "admin.localhost:3000", origin: "http://admin.localhost:3000",
      body: { confirmed_in_bank: true },
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("CAPACITY_GONE");
    expect(await getTierState(db, tier.id)).toMatchObject({ sold: 0, reserved: 2 });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("EXPIRED");
    expect(await db.ticketUnit.count({ where: { orderId: order.id } })).toBe(0);
    expect(await db.emailJob.count({ where: { orderId: order.id, kind: "TICKETS" } })).toBe(0);
    expect(await db.auditLogEntry.count({ where: { entityId: order.id, action: "ORDER_REVIVED" } })).toBe(0);
  });

  test("a sweep locks tiers globally across orders, avoiding a cycle with a multi-tier writer", async () => {
    const first = await createTestTier(db, "baseline-lock-first", 20);
    const second = await createTestTier(db, "baseline-lock-second", 20);
    const [low, high] = [first, second].sort((a, b) => a.id.localeCompare(b.id));
    const event = await getFixtureEvent(db);
    const account = await db.paymentAccount.findFirstOrThrow({ where: { isActive: true } });
    const [id1, id2] = [crypto.randomUUID(), crypto.randomUUID()].sort();
    // Opposite ORDER-id and TIER-id ordering exposed the old per-order sweep.
    await db.ticketTier.updateMany({ where: { id: { in: [low.id, high.id] } }, data: { reserved: 1 } });
    for (const [id, tier] of [[id1, high], [id2, low]] as const) {
      await db.order.create({ data: {
        id, orderCode: `SR-${id.slice(0, 6).toUpperCase()}`, eventId: event.id,
        customerName: "Lock Test", customerEmail: `${id}@test.ng`, customerPhone: "08012345678",
        totalKobo: tier.priceKobo, paymentAccountId: account.id,
        holdExpiresAt: new Date(Date.now() - 60_000),
        lineItems: { create: { tierId: tier.id, quantity: 1, unitPriceKobo: tier.priceKobo } },
      } });
    }
    let announceLocked!: () => void;
    const locked = new Promise<void>((resolve) => { announceLocked = resolve; });
    let resume!: () => void;
    const proceed = new Promise<void>((resolve) => { resume = resolve; });
    const writer = db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE ticket_tiers SET price_kobo = price_kobo WHERE id = ${low.id}::uuid`;
      announceLocked();
      await proceed;
      await tx.$executeRaw`UPDATE ticket_tiers SET price_kobo = price_kobo WHERE id = ${high.id}::uuid`;
    }, { timeout: 15_000 });
    await locked;
    const sweep = runSweep();
    let blocked = false;
    try {
      // Synchronize on the database's wait state, not a sleep or guessed delay.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const waiting = await db.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%UPDATE ticket_tiers%'
        `;
        if (Number(waiting[0].count) > 0) { blocked = true; break; }
      }
    } finally { resume(); }
    const [writerResult, sweepResult] = await Promise.allSettled([writer, sweep]);
    expect(blocked).toBe(true);
    expect(writerResult.status).toBe("fulfilled");
    expect(sweepResult.status).toBe("fulfilled");
    if (sweepResult.status === "fulfilled") expect(sweepResult.value.status).toBe(200);
    expect(await getTierState(db, low.id)).toMatchObject({ reserved: 0 });
    expect(await getTierState(db, high.id)).toMatchObject({ reserved: 0 });
  });
});
