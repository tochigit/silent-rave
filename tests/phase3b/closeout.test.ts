import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  api,
  backdateHold,
  check,
  checkEqual,
  createTestTier,
  getFixtureEvent,
  getTierState,
  initializeOrder,
  makeDb,
  runSweep,
  submitProof,
} from "./helpers";
import "./load-env";

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 CLOSE-OUT — dedicated evidence file for the seven review fixes.
//
//   A1  initialize rejects ENDED events (v2.1.1 CHANGELOG item 1): a past,
//       date-confirmed, PUBLISHED event with an open sales window must 409;
//       an event IN PROGRESS (starts_at past, ends_at future) stays buyable.
//   A4  lookup per-code rate limiting: the counter increments for
//       NONEXISTENT codes too, and once limited the response is identical
//       for an existing code and a nonexistent one (no existence oracle).
//   A5  db:fixture refuses to run under NODE_ENV=production or when
//       DATABASE_URL points anywhere but the embedded local server.
//   A6  unresolved-order cap under CONCURRENCY: same email, parallel
//       initialize on different tiers — at most 2 succeed (advisory xact
//       locks serialize the count).
//   B   proof submission vs expiry sweep racing on a hold-boundary order:
//       consistent final state, inventory released exactly once, and the
//       PENDING proof on the released order is a properly-flagged LATE proof
//       (never an orphan non-late one).
//
// TIME CONTROL: no test waits on wall-clock time. Holds/grace windows are
// moved by BACKDATING rows (`UPDATE orders SET hold_expires_at = now() - …`),
// not by sleeping — see backdateHold in helpers.ts.
// IP buckets: this file uses 10.70.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const db = makeDb();

afterAll(async () => {
  await db.$disconnect();
});

// ── A1 ───────────────────────────────────────────────────────────────────────

describe("A1 — initialize rejects ended events (03 v2.1.1: ends_at > now())", () => {
  test("ENDED event (PUBLISHED, date-confirmed, open sales window) → 409, nothing reserved", async () => {
    const organizer = await db.organizer.findFirstOrThrow();
    const venue = await db.venue.findFirstOrThrow();
    const endedEvent = await db.event.create({
      data: {
        slug: `ended-${Date.now()}`,
        title: "Already Ended",
        description: "x",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // started 3h ago
        endsAt: new Date(Date.now() - 60 * 60 * 1000), //       ended 1h ago
        status: "PUBLISHED",
        isDateConfirmed: true, // date-confirmed and published — still not buyable
      },
    });
    const endedTier = await db.ticketTier.create({
      data: { eventId: endedEvent.id, name: "Past", priceKobo: 100000, capacity: 5 },
      // no sales window at all → the ONLY blocker is ends_at <= now()
    });

    const { status, response } = await initializeOrder({
      tierId: endedTier.id,
      eventId: endedEvent.id,
      email: `ended-${Date.now()}@closeout.test`,
      phone: "09711112222",
      ip: "10.70.0.2",
    });
    const body = await response.json().catch(() => ({}));
    checkEqual(status, 409, "ended event → 409 (INVALID_STATE maps to 409)");
    checkEqual(body.code, "INVALID_STATE", "error code INVALID_STATE");
    check(!!body.error, "human-readable message present");

    const state = await db.ticketTier.findUniqueOrThrow({ where: { id: endedTier.id } });
    checkEqual(state.reserved, 0, "nothing reserved for a past event");
    const orders = await db.order.count({ where: { eventId: endedEvent.id } });
    checkEqual(orders, 0, "no order row created");
  });

  test("event IN PROGRESS (starts_at past, ends_at future) → still purchasable (201)", async () => {
    const organizer = await db.organizer.findFirstOrThrow();
    const venue = await db.venue.findFirstOrThrow();
    const ongoingEvent = await db.event.create({
      data: {
        slug: `ongoing-${Date.now()}`,
        title: "Happening Now",
        description: "x",
        organizerId: organizer.id,
        venueId: venue.id,
        startsAt: new Date(Date.now() - 60 * 60 * 1000), // started 1h ago
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // ends in 2h
        status: "PUBLISHED",
        isDateConfirmed: true,
      },
    });
    const ongoingTier = await db.ticketTier.create({
      data: { eventId: ongoingEvent.id, name: "Door", priceKobo: 150000, capacity: 5 },
    });

    const { status, body } = await initializeOrder({
      tierId: ongoingTier.id,
      eventId: ongoingEvent.id,
      email: `ongoing-${Date.now()}@closeout.test`,
      phone: "09722223333",
      ip: "10.70.0.3",
    });
    checkEqual(status, 201, "in-progress event is still buyable (only ENDED is refused)");
    check(!!body && /^SR-/.test(body.order_code), "order allocated");
    const state = await db.ticketTier.findUniqueOrThrow({ where: { id: ongoingTier.id } });
    checkEqual(state.reserved, 1, "reservation made for the in-progress event");
  });
});

// ── A6 ───────────────────────────────────────────────────────────────────────

describe("A6 — same-email CONCURRENT checkout cannot exceed the 2-unresolved cap", () => {
  test("5 PARALLEL initialize (same email, different tiers): exactly 2 succeed, 3 get 429, caps never exceeded", async () => {
    // Five dedicated tiers so the only contention is the per-email cap (and
    // the advisory lock that serializes it), never tier inventory.
    // Prepare fixtures sequentially so setup does not expand Prisma's pool
    // concurrently on Windows. The checkout requests below remain parallel.
    const tiers: Awaited<ReturnType<typeof createTestTier>>[] = [];
    for (let i = 0; i < 5; i++) {
      tiers.push(await createTestTier(db, `a6-tier-${i}`, 10));
    }
    const email = `a6-race-${Date.now()}@closeout.test`;
    const before: Awaited<ReturnType<typeof getTierState>>[] = [];
    for (const tier of tiers) before.push(await getTierState(db, tier.id));

    // Same email, DISTINCT phones, one IP — the EMAIL cap is the only binder.
    const attempts = await Promise.all(
      tiers.map((tier, i) =>
        initializeOrder({
          tierId: tier.id,
          // Keep setup connections out of the concurrent checkout requests.
          eventId: tier.eventId,
          quantity: 1,
          email,
          phone: `098${String(10000000 + i)}`,
          ip: "10.70.0.1",
        })
      )
    );

    const statuses = attempts.map((a) => a.status).sort();
    const ok = statuses.filter((s) => s === 201).length;
    const limited = statuses.filter((s) => s === 429).length;
    checkEqual(ok, 2, `exactly the cap (2) succeed — statuses: ${statuses.join(",")}`);
    checkEqual(limited, 3, "the other 3 concurrent attempts are refused");
    for (const attempt of attempts) {
      if (attempt.status === 429) {
        const body = await attempt.response.json().catch(() => ({}));
        checkEqual(body.code, "TOO_MANY_UNRESOLVED", "refusal code is the unresolved-order cap");
      }
    }

    // DB truth: at most (exactly) 2 unresolved orders for that email, and the
    // reservations agree — no phantom third order from the race.
    const unresolved = await db.order.count({
      where: {
        customerEmail: email,
        status: { in: ["AWAITING_PAYMENT", "PROOF_SUBMITTED", "NEEDS_RESUBMIT"] },
      },
    });
    checkEqual(unresolved, 2, "exactly 2 unresolved orders committed for the racing email");
    const after: Awaited<ReturnType<typeof getTierState>>[] = [];
    for (const tier of tiers) after.push(await getTierState(db, tier.id));
    const reservedTotal = after.reduce((sum, t) => sum + t.reserved, 0) - before.reduce((sum, t) => sum + t.reserved, 0);
    checkEqual(reservedTotal, 2, "exactly 2 units reserved across the 5 tiers");
    for (let i = 0; i < tiers.length; i++) {
      check(after[i].reserved - before[i].reserved <= 1, `tier ${i} reserved at most its 1 unit`);
    }
  });
});

// ── A4 ───────────────────────────────────────────────────────────────────────

describe("A4 — lookup rate limiting counts nonexistent codes; limited responses are identical", () => {
  async function lookup(code: string, email: string, ip: string): Promise<{ status: number; text: string }> {
    const response = await api("/api/orders/lookup", { ip, body: { order_code: code, email } });
    return { status: response.status, text: await response.text() };
  }

  test("a NONEXISTENT code fills its own per-code bucket: 4th lookup of a fake code → 429", async () => {
    // Three lookups of a code that matches no order — each must increment the
    // per-code counter (the fix: the counter runs BEFORE the SELECT, so it
    // counts unknown codes exactly like existing ones).
    const fakeCode = "SR-FAKE77";
    const ip = "10.70.1.1";
    for (let i = 0; i < 3; i++) {
      const { status } = await lookup(fakeCode, `a4-fake-${i}@closeout.test`, ip);
      checkEqual(status, 202, `fake-code lookup ${i + 1} → generic 202 (bucket fills)`);
    }
    const fourth = await lookup(fakeCode, "a4-fake-4@closeout.test", ip);
    checkEqual(fourth.status, 429, "4th lookup of the NONEXISTENT code is limited — its counter did increment");
  });

  test("after the threshold, an EXISTING code and a NONEXISTENT code get the IDENTICAL limited response", async () => {
    // A real order (dedicated tier), then fill ITS code bucket to the limit
    // from a fresh IP with non-matching emails (no jobs created).
    const tier = await createTestTier(db, "a4-real-tier", 5);
    const { status, body } = await initializeOrder({
      tierId: tier.id,
      email: `a4-real-${Date.now()}@closeout.test`,
      phone: "09911112222",
      ip: "10.70.1.2",
    });
    checkEqual(status, 201, "fixture order for the real code");
    const realCode = body!.order_code;

    const fakeCode = "SR-FAKE88";
    const ipReal = "10.70.1.3";
    const ipFake = "10.70.1.4";
    for (let i = 0; i < 3; i++) {
      const real = await lookup(realCode, `a4-real-${i}@closeout.test`, ipReal);
      checkEqual(real.status, 202, `real-code lookup ${i + 1} passes`);
      const fake = await lookup(fakeCode, `a4-fake-${i}@closeout.test`, ipFake);
      checkEqual(fake.status, 202, `fake-code lookup ${i + 1} passes`);
    }

    const limitedReal = await lookup(realCode, "a4-real-4@closeout.test", ipReal);
    const limitedFake = await lookup(fakeCode, "a4-fake-4@closeout.test", ipFake);
    checkEqual(limitedReal.status, 429, "4th lookup of the EXISTING code → 429");
    checkEqual(limitedFake.status, 429, "4th lookup of the NONEXISTENT code → 429");
    checkEqual(limitedReal.status, limitedFake.status, "identical status codes");
    checkEqual(
      limitedReal.text,
      limitedFake.text,
      `byte-identical bodies (no existence oracle): ${limitedReal.text} | ${limitedFake.text}`
    );
    // The only per-response difference allowed is the Retry-After header
    // (seconds until THIS requester's own bucket resets — a function of when
    // the attacker themselves started hammering, not of code existence).
    checkEqual(JSON.parse(limitedReal.text).error, "Too many lookups for this order code.", "the generic limited body");
  });
});

// ── A5 ───────────────────────────────────────────────────────────────────────

describe("A5 — db:fixture refuses unsafe environments (guards run before ANY destructive step)", () => {
  const FIXTURE_SCRIPT = fileURLToPath(new URL("../../scripts/dev-fixture.ts", import.meta.url));

  /** Runs the fixture script in a subprocess under the given env overrides. */
  async function runFixture(
    env: Record<string, string | undefined>
  ): Promise<{ exitCode: number; output: string; timedOut: boolean }> {
    const merged: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...env })) {
      if (value !== undefined) merged[key] = value;
    }
    const proc = Bun.spawn([process.execPath, "--no-env-file", FIXTURE_SCRIPT], {
      cwd: process.cwd(),
      env: merged,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, 20_000);
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timeout);
    return { exitCode, output: `${stdout}${stderr}`, timedOut };
  }

  test("NODE_ENV=production → refuses (exit 1) before doing anything", async () => {
    const result = await runFixture({ NODE_ENV: "production" });
    check(!result.timedOut, "guard subprocess did not hang");
    checkEqual(result.exitCode, 1, `exit code 1 (got ${result.exitCode})`);
    check(result.output.includes("NODE_ENV=production"), `refusal names NODE_ENV: ${result.output.trim()}`);
    check(result.output.includes("refusing to run"), "explicit refusal message");
    check(!result.output.includes("wiping"), "NO destructive step executed");
    check(!result.output.includes("initdb"), "cluster untouched");
  });

  test("DATABASE_URL pointing at a non-embedded Postgres → refuses (exit 1) before doing anything", async () => {
    const result = await runFixture({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres@db.production.example.com:5432/silentrave",
    });
    check(!result.timedOut, "guard subprocess did not hang");
    checkEqual(result.exitCode, 1, `exit code 1 (got ${result.exitCode})`);
    check(
      result.output.includes("not the embedded local server"),
      `refusal names the foreign host: ${result.output.trim()}`
    );
    check(!result.output.includes("wiping"), "NO destructive step executed");
  });

  // Positive control: the suite runner uses the same startFixture function
  // successfully. A second dev fixture would start another app unnecessarily.
});

// ── B — proof submission vs sweep race at the hold boundary ─────────────────

describe("B — proof vs sweep racing on a hold-boundary order (no orphan PENDING proofs)", () => {
  test("lapsed hold, proof upload and sweep in parallel: EXPIRED + released exactly once + ONE late-flagged PENDING proof", async () => {
    const tier = await createTestTier(db, "b-race-tier", 10);
    const { status, body } = await initializeOrder({
      tierId: tier.id,
      quantity: 2,
      email: `b-race-${Date.now()}@closeout.test`,
      phone: "09922223333",
      ip: "10.70.2.1",
    });
    checkEqual(status, 201, "fixture order");
    const orderCode = body!.order_code;
    const before = await getTierState(db, tier.id);

    // Move the order to the hold boundary: lapsed 1 minute ago, no proof yet.
    await backdateHold(db, orderCode, 60 * 1000);

    // RACE: the buyer's proof upload and the cron sweep hit the same order
    // at the same moment. Whichever locks the row first:
    //   proof-first  → its lazy in-tx expiry releases, then the LATE path
    //   sweep-first  → releases; the proof then takes the LATE path
    // Both interleavings must converge to the same consistent state.
    const [proofResult, sweepResult] = await Promise.all([
      submitProof({
        orderCode,
        statusToken: body!.status_token,
        reference: `BRACE${Date.now()}`,
        submissionId: `b-race-${Date.now()}`,
        ip: "10.70.2.2",
      }),
      runSweep(),
    ]);

    checkEqual(sweepResult.status, 200, "sweep completes");
    checkEqual(proofResult.status, 200, "proof submission completes (late path)");
    checkEqual(proofResult.body.late, true, "the boundary order took the LATE path");
    checkEqual(proofResult.body.status, "EXPIRED", "response reports the order stays EXPIRED");

    const order = await db.order.findUniqueOrThrow({ where: { orderCode } });
    checkEqual(order.status, "EXPIRED", "final status EXPIRED (consistent: not PROOF_SUBMITTED on a lapsed hold)");
    checkEqual(order.inventoryReleased, true, "inventory_released set exactly once");

    const after = await getTierState(db, tier.id);
    checkEqual(after.reserved, before.reserved - 2, "reserved decremented EXACTLY once (by 2) — no double release");
    check(after.reserved >= 0, "reserved never negative");
    check(after.sold + after.reserved <= after.capacity, "CHECK (sold+reserved<=capacity) holds");

    // The proof on the released order is a properly-flagged LATE proof — never
    // an orphan non-late PENDING proof (which would look held while released).
    const proofs = await db.paymentProof.findMany({ where: { orderId: order.id } });
    checkEqual(proofs.length, 1, "exactly ONE proof row");
    checkEqual(proofs[0].status, "PENDING", "the late proof is PENDING (revive-or-dismiss flow)");
    checkEqual((proofs[0].flags as Record<string, unknown>).late, true, "flags.late = true (NOT an orphan non-late proof)");
    const proofReceived = await db.emailJob.count({
      where: { orderId: order.id, kind: "PROOF_RECEIVED", dedupeKey: "initial" },
    });
    checkEqual(proofReceived, 1, "PROOF_RECEIVED email job queued (late or not)");

    // And the queue surfaces it for revive-or-dismiss (EXPIRED_HAD_PROOF).
    const { login } = await import("./helpers");
    const owner = await login(
      process.env.OWNER_EMAIL ?? "owner@silentrave.ng",
      process.env.OWNER_PASSWORD ?? "silentrave-dev-owner"
    );
    const queue = await api("/api/admin/payments?status=EXPIRED_HAD_PROOF", {
      host: "localhost:3000",
      cookies: owner.cookies,
    });
    const queueBody = await queue.json();
    check(
      queueBody.queue.some((row: any) => row.order_code === orderCode),
      "raced order is in the EXPIRED_HAD_PROOF review queue"
    );
  });
});
