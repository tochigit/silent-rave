import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api, check, checkEqual, createTestTier, initializeOrder, makeDb } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/lookup (03 v2.1 as changed by CHANGELOG item 6):
//   • ALWAYS 202 with the SAME generic body — byte-identical for match and
//     non-match, response and timing must not reveal which field was wrong
//   • STATUS_LINK email job created ONLY on a code+email match (fresh key)
//   • NEVER returns order data
//   • rate limited per IP and per order code
//
// Each test uses its OWN fixture order so the per-code rate bucket (3/h)
// can never bleed across tests. IP buckets: 10.60.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const db = makeDb();
let lookupTier: { id: string };
const orders: Record<string, { code: string; email: string; id: string }> = {};

async function makeOrder(key: string): Promise<void> {
  const { status, body } = await initializeOrder({
    tierId: lookupTier.id,
    email: `lookup-${key}-${Date.now()}@test.ng`,
    phone: `095${String(Math.floor(10000000 + Math.random() * 8999999))}`,
    ip: `10.60.0.${Object.keys(orders).length + 1}`,
  });
  checkEqual(status, 201, `fixture order ${key}`);
  const order = await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } });
  orders[key] = { code: body!.order_code, email: order.customerEmail, id: order.id };
}

beforeAll(async () => {
  lookupTier = await createTestTier(db, "lookup-tier", 50);
  // One dedicated order per test group (per-code rate buckets never overlap:
  // uniform gets exactly 3 uses — byte-identical ×2 + no-order-data ×1).
  await makeOrder("uniform"); //    uniform-202 + no-order-data tests
  await makeOrder("malformed"); //   malformed-body byte comparison
  await makeOrder("jobs"); //       STATUS_LINK job test
  await makeOrder("ratelimit"); //  per-code rate-limit test
});

afterAll(async () => {
  await db.$disconnect();
});

async function lookup(code: string, email: string, ip: string): Promise<{ status: number; text: string }> {
  const response = await api("/api/orders/lookup", {
    ip,
    body: { order_code: code, email },
  });
  return { status: response.status, text: await response.text() };
}

describe("lookup — uniform 202 responses, no order data", () => {
  test("matching and non-matching code/email give byte-identical 202 bodies", async () => {
    const target = orders.uniform;
    const match = await lookup(target.code, target.email, "10.60.1.1");
    const wrongEmail = await lookup(target.code, "not-the-buyer@example.com", "10.60.1.1");
    const wrongCode = await lookup("SR-NOPE42", target.email, "10.60.1.1");
    const bothWrong = await lookup("SR-NOPE43", "nobody@example.com", "10.60.1.1");

    checkEqual(match.status, 202, "match → 202");
    checkEqual(wrongEmail.status, 202, "wrong email → 202");
    checkEqual(wrongCode.status, 202, "wrong code → 202");
    checkEqual(bothWrong.status, 202, "both wrong → 202");

    checkEqual(match.text, wrongEmail.text, "match vs wrong-email bodies byte-identical");
    checkEqual(match.text, wrongCode.text, "match vs wrong-code bodies byte-identical");
    checkEqual(match.text, bothWrong.text, "match vs both-wrong bodies byte-identical");
    check(!match.text.includes(target.code), "generic body never echoes the code");
    check(!match.text.includes(target.email), "generic body never echoes the email");
  });

  test("malformed body → same generic 202 (no validation oracle)", async () => {
    const malformed = await api("/api/orders/lookup", { ip: "10.60.1.2", body: { nonsense: true } });
    checkEqual(malformed.status, 202, "malformed → 202");
    const target = orders.malformed; // dedicated order — its own code bucket
    const match = await lookup(target.code, target.email, "10.60.1.2");
    checkEqual(await malformed.text(), match.text, "byte-identical with the generic body");
  });

  test("no order data in any response payload", async () => {
    const target = orders.uniform;
    const responses = [
      await lookup(target.code, target.email, "10.60.1.3"), // 3rd use of this code bucket — still within 3/h
      await lookup("SR-NOPE44", target.email, "10.60.1.3"),
      await lookup("SR-NOPE45", "wrong@example.com", "10.60.1.3"),
    ];
    for (const { text } of responses) {
      const parsed = JSON.parse(text);
      checkEqual(Object.keys(parsed).join(","), "message", "only the generic message field");
      checkEqual(
        parsed.message,
        "If those details match an order, we have emailed its status link.",
        "exact generic copy"
      );
    }
  });
});

describe("lookup — STATUS_LINK jobs (match only, fresh keys, nothing sent)", () => {
  test("job created ONLY on a match, with a fresh key each time", async () => {
    const target = orders.jobs;
    const before = await db.emailJob.count({ where: { orderId: target.id, kind: "STATUS_LINK" } });
    checkEqual(before, 0, "no STATUS_LINK jobs to start");

    await lookup(target.code, target.email, "10.60.1.4"); // match → job
    await lookup(target.code, "wrong@example.com", "10.60.1.4"); // non-match
    await lookup("SR-NOPE46", target.email, "10.60.1.4"); // non-match
    await lookup(target.code, target.email, "10.60.1.4"); // match → job

    const jobs = await db.emailJob.findMany({
      where: { orderId: target.id, kind: "STATUS_LINK" },
      select: { dedupeKey: true, status: true },
    });
    checkEqual(jobs.length, 2, "exactly the two MATCHING lookups created jobs");
    checkEqual(new Set(jobs.map((j) => j.dedupeKey)).size, 2, "every STATUS_LINK key is fresh/unique");
    check(jobs.every((j) => j.dedupeKey.startsWith("statuslink-")), "fresh keys follow the statuslink- pattern");
    // No email is actually sent in this phase: the job rows stay QUEUED.
    check(jobs.every((j) => j.status === "QUEUED"), "job rows only — nothing sent");
  });
});

describe("lookup — rate limits (per IP and per order code)", () => {
  test("per-code limit triggers at its threshold (3/hour)", async () => {
    const target = orders.ratelimit;
    const ip = "10.60.2.1"; // fresh IP bucket
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      // non-matching emails: no jobs created, but the CODE bucket still fills
      const { status } = await lookup(target.code, `ratelimit-${i}@example.com`, ip);
      statuses.push(status);
    }
    checkEqual(statuses[0], 202, "first lookup passes");
    checkEqual(statuses[2], 202, "third lookup passes (limit 3)");
    checkEqual(statuses[3], 429, "fourth lookup for the same code → 429");
  });

  test("per-IP limit triggers at its threshold (10/hour)", async () => {
    const ip = "10.60.2.2"; // dedicated bucket
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // distinct codes: no per-code bucket fills, only the IP bucket
      const { status } = await lookup(`SR-RL${String(i).padStart(2, "0")}X`, `iprl-${i}@example.com`, ip);
      statuses.push(status);
    }
    checkEqual(statuses.filter((s) => s === 202).length, 10, "first 10 pass");
    checkEqual(statuses[10], 429, "11th from the same IP → 429");
  });
});
