import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  api,
  check,
  checkEqual,
  createTestTier,
  getFixtureEvent,
  getFixtureTier,
  initializeOrder,
  makeDb,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Checkout initialize — validation, SERVER-SIDE PRICING, atomic conditional
// reservation (concurrency), abuse limits, rate limits (03 v2.1 + 02 + 04).
// IP buckets per file: this file uses 10.20.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const db = makeDb();

let tierRegular: { id: string; eventId: string; priceKobo: number; capacity: number };

beforeAll(async () => {
  tierRegular = await getFixtureTier(db, "Regular");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("initialize — validation list (03)", () => {
  test("happy path: 201, order code from the unambiguous alphabet, derived status token, server-side price", async () => {
    const { status, body } = await initializeOrder({
      tierId: tierRegular.id,
      quantity: 2,
      holderNames: ["Ada", "Chidi"],
      ip: "10.20.0.1",
      email: "happy@checkout.test",
    });
    checkEqual(status, 201, "initialize should succeed");
    check(body, "body present");
    check(/^SR-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/.test(body.order_code), `order_code unambiguous alphabet, got ${body.order_code}`);
    checkEqual(body.amount_kobo, tierRegular.priceKobo * 2, "amount = server-side price × qty");
    check(typeof body.status_token === "string" && body.status_token.length > 30, "derived status token returned");
    // The ACTIVE account at creation time is snapshotted (which account is
    // active can legitimately change during the suite — assert the shape +
    // the DB snapshot instead of a hard-coded seed value).
    check(
      typeof body.payment_account.bank_name === "string" &&
        /^[0-9]{6,20}$/.test(body.payment_account.account_number) &&
        typeof body.payment_account.account_name === "string",
      "payment_account object with bank details returned"
    );
    check(!!body.hold_expires_at, "hold_expires_at returned");
    // DB: order + line item with price snapshot; nothing minted.
    const order = await db.order.findUniqueOrThrow({ where: { orderCode: body.order_code } });
    checkEqual(order.status, "AWAITING_PAYMENT", "order starts AWAITING_PAYMENT");
    checkEqual(order.source, "ONLINE", "online source");
    checkEqual(order.statusTokenVersion, 1, "token version 1");
    checkEqual(order.totalKobo, tierRegular.priceKobo * 2, "total_kobo server-side");
    check(order.paymentAccountId !== null, "payment_account_id snapshotted on order");
    const activeAccount = await db.paymentAccount.findFirstOrThrow({ where: { isActive: true } });
    checkEqual(order.paymentAccountId, activeAccount.id, "snapshot = the account that was ACTIVE at creation");
    check(order.holdExpiresAt !== null, "hold set (15 min window)");
    check(Math.abs(order.holdExpiresAt!.getTime() - Date.now() - 15 * 60 * 1000) < 60_000, "hold ≈ now + 15 min");
    const line = await db.orderLineItem.findFirstOrThrow({ where: { orderId: order.id } });
    checkEqual(line.unitPriceKobo, tierRegular.priceKobo, "line item carries the price snapshot");
    checkEqual((line.holderNames as string[]).length, 2, "holder_names stored");
    const tickets = await db.ticketUnit.count({ where: { orderId: order.id } });
    checkEqual(tickets, 0, "no ticket_units minted at checkout");
  });

  test("holder_names length mismatch → 400", async () => {
    const { status } = await initializeOrder({ tierId: tierRegular.id, quantity: 3, holderNames: ["A"], ip: "10.20.0.2" });
    checkEqual(status, 400, "holder_names mismatch rejected");
  });

  test("quantity over MAX_QTY_PER_ORDER (10) → 400", async () => {
    const { status } = await initializeOrder({ tierId: tierRegular.id, quantity: 11, ip: "10.20.0.2" });
    checkEqual(status, 400, "quantity > 10 rejected");
  });

  test("tier belonging to a different event → 400 (VALIDATION)", async () => {
    // A tier on a brand-new second event.
    const event = await getFixtureEvent(db);
    const otherEvent = await db.event.create({
      data: {
        slug: `other-event-${Date.now()}`,
        title: "Other",
        description: "x",
        organizerId: (await db.organizer.findFirstOrThrow()).id,
        venueId: (await db.venue.findFirstOrThrow()).id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 * 2),
        status: "PUBLISHED",
        isDateConfirmed: true,
      },
    });
    const otherTier = await db.ticketTier.create({
      data: { eventId: otherEvent.id, name: "Ghost", priceKobo: 1000, capacity: 5 },
    });
    // tier belongs to otherEvent, but the request is for the fixture event
    const { status, response } = await initializeOrder({ tierId: otherTier.id, ip: "10.20.0.2" });
    const body = await response.json().catch(() => ({}));
    checkEqual(status, 400, "cross-event tier rejected");
    checkEqual(body.code, "VALIDATION", "cross-event tier error code");
    check(event.id !== otherEvent.id, "sanity");
    await db.event.delete({ where: { id: otherEvent.id } }); // cascade removes tier
  });

  test("DRAFT event → 409; unconfirmed date → 409", async () => {
    const organizer = await db.organizer.findFirstOrThrow();
    const venue = await db.venue.findFirstOrThrow();
    const draftEvent = await db.event.create({
      data: {
        slug: `draft-${Date.now()}`,
        title: "Draft",
        description: "x",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 * 2),
        status: "DRAFT",
        isDateConfirmed: true,
      },
    });
    const draftTier = await db.ticketTier.create({
      data: { eventId: draftEvent.id, name: "D", priceKobo: 1000, capacity: 5 },
    });
    const draftResult = await initializeOrder({ tierId: draftTier.id, eventId: draftEvent.id, ip: "10.20.0.2" });
    checkEqual(draftResult.status, 409, "DRAFT event not purchasable");

    const unconfirmed = await db.event.create({
      data: {
        slug: `unconf-${Date.now()}`,
        title: "Unconfirmed",
        description: "x",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 * 2),
        status: "PUBLISHED",
        isDateConfirmed: false, // v2.1: sales require a confirmed date
      },
    });
    const unconfTier = await db.ticketTier.create({
      data: { eventId: unconfirmed.id, name: "U", priceKobo: 1000, capacity: 5 },
    });
    const unconfResult = await initializeOrder({ tierId: unconfTier.id, eventId: unconfirmed.id, ip: "10.20.0.2" });
    checkEqual(unconfResult.status, 409, "unconfirmed-date event not purchasable");

    await db.event.delete({ where: { id: draftEvent.id } });
    await db.event.delete({ where: { id: unconfirmed.id } });
  });

  test("sales window closed → 409", async () => {
    const tier = await createTestTier(db, "window-closed-tier", 5);
    await db.ticketTier.update({ where: { id: tier.id }, data: { salesEndAt: new Date(Date.now() - 60000) } });
    const { status } = await initializeOrder({ tierId: tier.id, ip: "10.20.0.2" });
    checkEqual(status, 409, "closed sales window rejected");
  });

  test("no active payment account → 503 and nothing reserved", async () => {
    const tier = await createTestTier(db, "no-account-tier", 5);
    const activeBefore = await db.paymentAccount.findFirstOrThrow({ where: { isActive: true } });
    await db.paymentAccount.update({ where: { id: activeBefore.id }, data: { isActive: false } });
    try {
      const { status, response } = await initializeOrder({ tierId: tier.id, ip: "10.20.0.2" });
      const body = await response.json().catch(() => ({}));
      checkEqual(status, 503, "no active account → 503");
      checkEqual(body.code, "NO_PAYMENT_ACCOUNT", "error code");
      const state = await db.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      checkEqual(state.reserved, 0, "nothing reserved on 503");
    } finally {
      await db.paymentAccount.update({ where: { id: activeBefore.id }, data: { isActive: true } });
    }
  });
});

describe("initialize — atomic conditional reservation under concurrency", () => {
  test("8 parallel requests for the last 4 units: exactly 4 succeed, 4 get 409, CHECKs never violated", async () => {
    // Dedicated tier with exactly 4 available units. The 8 parallel HTTP
    // requests are served by the dev server's Prisma pool (connection_limit=8
    // — separate pooled connections, Rust query engine).
    const tier = await createTestTier(db, "concurrency-tier", 4);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        initializeOrder({
          tierId: tier.id,
          quantity: 1,
          email: `racer-${i}@concurrency.test`,
          phone: `081${String(10000000 + i)}`,
          ip: "10.20.1.1",
        })
      )
    );

    const statuses = attempts.map((a) => a.status).sort();
    const ok = statuses.filter((s) => s === 201).length;
    const conflict = statuses.filter((s) => s === 409).length;
    checkEqual(ok, 4, `exactly the available count succeed (statuses: ${statuses.join(",")})`);
    checkEqual(conflict, 4, "the rest get 409");

    const state = await db.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    checkEqual(state.reserved, 4, "reserved == 4 (all units soft-held)");
    checkEqual(state.sold, 0, "sold stays 0 before approval");
    check(state.reserved + state.sold <= state.capacity, "CHECK (sold+reserved<=capacity) holds");

    const ordersCreated = await db.order.count({ where: { lineItems: { some: { tierId: tier.id } } } });
    checkEqual(ordersCreated, 4, "exactly 4 orders exist for the tier");
  });

  test("single line exceeding availability → 409 with nothing partially reserved", async () => {
    const tier = await createTestTier(db, "single-line-tier", 3);
    const { status } = await initializeOrder({ tierId: tier.id, quantity: 5, ip: "10.20.1.2" });
    checkEqual(status, 409, "over-capacity line rejected");
    const state = await db.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    checkEqual(state.reserved, 0, "no partial reservation");
  });

  test("multi-line order where ONE line fails → 409, the other line rolled back too", async () => {
    const goodTier = await createTestTier(db, "multi-good-tier", 10);
    const tinyTier = await createTestTier(db, "multi-tiny-tier", 1);
    const event = await getFixtureEvent(db);
    const response = await api("/api/checkout/initialize", {
      ip: "10.20.1.3",
      body: {
        event_id: event.id,
        customer_name: "Multi Line",
        customer_email: "multiline@concurrency.test",
        customer_phone: "08233334444",
        line_items: [
          { tier_id: goodTier.id, quantity: 2 },
          { tier_id: tinyTier.id, quantity: 2 }, // only 1 available
        ],
      },
    });
    checkEqual(response.status, 409, "multi-line with one failing line → 409");
    const goodState = await db.ticketTier.findUniqueOrThrow({ where: { id: goodTier.id } });
    checkEqual(goodState.reserved, 0, "good line rolled back — nothing partially reserved");
  });
});

describe("initialize — abuse limits (04)", () => {
  test("third unresolved order for the same EMAIL is refused (cap 2)", async () => {
    const tier = await createTestTier(db, "email-cap-tier", 50);
    const email = `cap-${Date.now()}@limits.test`;
    for (let i = 0; i < 2; i++) {
      const { status } = await initializeOrder({
        tierId: tier.id,
        email,
        phone: `083${String(10000000 + i)}`,
        ip: "10.20.2.1",
      });
      checkEqual(status, 201, `order ${i + 1} for the email succeeds`);
    }
    const third = await initializeOrder({ tierId: tier.id, email, phone: "08399999999", ip: "10.20.2.1" });
    checkEqual(third.status, 429, "third unresolved order for the email → 429");
    const body = await third.response.json().catch(() => ({}));
    checkEqual(body.code, "TOO_MANY_UNRESOLVED", "error code TOO_MANY_UNRESOLVED");
  });

  test("third unresolved order for the same PHONE is refused (cap 2), across different emails", async () => {
    const tier = await createTestTier(db, "phone-cap-tier", 50);
    const phone = `084${Date.now()}`.slice(0, 11);
    for (let i = 0; i < 2; i++) {
      const { status } = await initializeOrder({
        tierId: tier.id,
        email: `phonecap-${i}-${Date.now()}@limits.test`,
        phone,
        ip: "10.20.2.2",
      });
      checkEqual(status, 201, `order ${i + 1} with the phone succeeds`);
    }
    const third = await initializeOrder({
      tierId: tier.id,
      email: `phonecap-3-${Date.now()}@limits.test`,
      phone,
      ip: "10.20.2.2",
    });
    checkEqual(third.status, 429, "third unresolved order for the phone → 429");
  });

  test("resolved orders don't count toward the cap (an APPROVED order frees the email)", async () => {
    const tier = await createTestTier(db, "cap-resolved-tier", 50);
    const email = `resolved-${Date.now()}@limits.test`;
    const first = await initializeOrder({ tierId: tier.id, email, phone: "08511111111", ip: "10.20.2.3" });
    await db.order.update({ where: { orderCode: first.body!.order_code }, data: { status: "APPROVED" } });
    const second = await initializeOrder({ tierId: tier.id, email, phone: "08522222222", ip: "10.20.2.3" });
    const third = await initializeOrder({ tierId: tier.id, email, phone: "08533333333", ip: "10.20.2.3" });
    checkEqual(second.status, 201, "second succeeds (first is APPROVED, not unresolved)");
    checkEqual(third.status, 201, "third succeeds (only 2 unresolved now: second+third… wait, third is the one being made)");
  });

  test("two different emails from the SAME IP are NOT blocked by any unresolved cap (IP is rate-only)", async () => {
    const tier = await createTestTier(db, "nat-tier", 50);
    const ip = "10.20.2.4";
    const emailA = `nat-a-${Date.now()}@limits.test`;
    const emailB = `nat-b-${Date.now()}@limits.test`;
    for (let i = 0; i < 3; i++) {
      const { status } = await initializeOrder({
        tierId: tier.id,
        email: emailA,
        phone: `086${String(10000000 + i)}`,
        ip,
      });
      checkEqual(status, i < 2 ? 201 : 429, `email A order ${i + 1} (cap at 3rd for the EMAIL, not the IP)`);
    }
    // Different email, SAME IP — the shared NAT must not block it.
    const other = await initializeOrder({ tierId: tier.id, email: emailB, phone: "08699999999", ip });
    checkEqual(other.status, 201, "different email from the same IP succeeds (campus NAT note)");
  });

  test("per-IP RATE limit triggers at its threshold (default 10/hour)", async () => {
    const tier = await createTestTier(db, "rate-tier", 100);
    const ip = "10.20.2.5"; // dedicated bucket, 10/h default
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const { status } = await initializeOrder({
        tierId: tier.id,
        email: `rate-${i}-${Date.now()}@limits.test`,
        phone: `087${String(10000000 + i)}`,
        ip,
      });
      statuses.push(status);
    }
    const okCount = statuses.filter((s) => s === 201).length;
    const limited = statuses.filter((s) => s === 429).length;
    checkEqual(okCount, 10, `first 10 initialize calls pass (statuses: ${statuses.join(",")})`);
    checkEqual(limited, 1, "the 11th is rate limited");
    const lastResponse = statuses[10];
    checkEqual(lastResponse, 429, "11th response is 429");
  });
});
