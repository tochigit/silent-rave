import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { db } from "@/lib/db";
import {
  api,
  createTestTier,
  initializeOrder,
  submitProof,
  backdateHold,
} from "../phase3b/helpers";
import { approveOrder, rejectOrder } from "@/lib/orders/review";
import { refundOrder } from "@/lib/orders/refund";
import { expireHolds } from "@/lib/orders/expiry";
async function fresh() {
  const tier = await createTestTier(db, "customer-status", 10);
  const result = await initializeOrder({
    tierId: tier.id,
    ip: crypto.randomUUID(),
  });
  expect(result.status).toBe(201);
  return { tier, ...result.body! };
}
async function status(f: { order_code: string; status_token: string }) {
  const r = await api(`/api/orders/${f.order_code}/status`, {
    headers: { "x-status-token": f.status_token },
  });
  expect(r.status).toBe(200);
  return r.json();
}
async function proof(
  f: { order_code: string; status_token: string },
  submissionId = crypto.randomUUID(),
) {
  const r = await submitProof({
    orderCode: f.order_code,
    statusToken: f.status_token,
    reference: crypto.randomUUID(),
    submissionId,
    ip: crypto.randomUUID(),
  });
  expect(r.status).toBe(200);
  return r;
}
async function row(f: { order_code: string }) {
  return db.order.findUniqueOrThrow({ where: { orderCode: f.order_code } });
}
test("private refreshed status includes exact recorded bank snapshot after edits and activating another bank", async () => {
  const f = await fresh();
  const order = await row(f);
  const account = await db.paymentAccount.findUniqueOrThrow({
    where: { id: order.paymentAccountId! },
  });
  let otherId: string | undefined;
  try {
    await db.paymentAccount.update({
      where: { id: account.id },
      data: {
        bankName: "Edited fixture bank",
        accountNumber: "9999999999",
        accountName: "Edited fixture name",
        isActive: false,
      },
    });
    otherId = (
      await db.paymentAccount.create({
        data: {
          bankName: "Different active bank",
          accountNumber: "1111111111",
          accountName: "Different fixture name",
          isActive: true,
        },
      })
    ).id;
    const data = await status(f);
    expect(data.payment_account).toEqual(f.payment_account);
    expect(data.amount_kobo).toBe(f.amount_kobo);
    expect(data.can_submit_proof).toBe(true);
    for (const key of [
      "customer_email",
      "customer_phone",
      "paymentAccountId",
      "statusTokenVersion",
      "storagePath",
    ])
      expect(JSON.stringify(data)).not.toContain(key);
  } finally {
    if (otherId) await db.paymentAccount.delete({ where: { id: otherId } });
    await db.paymentAccount.update({
      where: { id: account.id },
      data: {
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        isActive: account.isActive,
      },
    });
  }
});
test("status uniform 404 and page/API private/no-referrer headers", async () => {
  const f = await fresh();
  const responses = await Promise.all([
    api(`/api/orders/${f.order_code}/status`),
    api(`/api/orders/${f.order_code}/status?t=wrong`),
    api("/api/orders/SR-NONEXIST/status?t=wrong"),
  ]);
  const bodies = await Promise.all(responses.map((r) => r.text()));
  expect(new Set(bodies).size).toBe(1);
  for (const r of responses) {
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  }
  const page = await api(`/order/${f.order_code}?t=${f.status_token}`);
  expect(page.status).toBe(200);
  expect(page.headers.get("referrer-policy")).toBe("no-referrer");
  expect(page.headers.get("cache-control")).toContain("no-store");
  expect(page.headers.get("content-security-policy")).toContain(
    "frame-src 'none'",
  );
});
test("pending/resubmittable/final rejection status, remaining attempts and idempotent retry", async () => {
  const f = await fresh();
  const id = crypto.randomUUID();
  await proof(f, id);
  const owner = await db.staffUser.findFirstOrThrow({
    where: { role: "OWNER" },
  });
  const order = await row(f);
  let data = await status(f);
  expect(data.status).toBe("PROOF_SUBMITTED");
  expect(data.pending_proof).toBe(true);
  expect(data.can_submit_proof).toBe(false);
  await proof(f, id);
  expect((await status(f)).proof_attempts).toBe(1);
  await rejectOrder(order.id, owner.id, {
    reasonCode: "UNREADABLE",
    message: "Fixture: re-upload",
    final: false,
  });
  data = await status(f);
  expect(data.status).toBe("NEEDS_RESUBMIT");
  expect(data.can_submit_proof).toBe(true);
  expect(data.rejection.message).toBe("Fixture: re-upload");
  expect(1 + data.max_resubmissions - data.proof_attempts).toBe(3);
  await proof(f);
  await rejectOrder(order.id, owner.id, {
    reasonCode: "NOT_RECEIVED",
    message: "Fixture: final",
    final: true,
  });
  data = await status(f);
  expect(data.status).toBe("REJECTED");
  expect(data.can_submit_proof).toBe(false);
  expect(data.tickets).toBeUndefined();
});
test("expired grace without proof, late PENDING proof, out-of-grace and timely proof at cap", async () => {
  const f = await fresh();
  await backdateHold(db, f.order_code, 60000);
  await expireHolds();
  let data = await status(f);
  expect(data.status).toBe("EXPIRED");
  expect(data.can_submit_proof).toBe(true);
  await proof(f);
  data = await status(f);
  expect(data.status).toBe("EXPIRED");
  expect(data.pending_proof).toBe(true);
  expect(data.late_proof_received).toBe(true);
  expect(data.can_submit_proof).toBe(false);
  const old = await fresh();
  await backdateHold(db, old.order_code, 25 * 3600000);
  await expireHolds();
  expect((await status(old)).can_submit_proof).toBe(false);
  const pending = await fresh();
  await proof(pending);
  // Reproduce a timely proof reaching the 48h cap, without sleeping.
  await db.order.update({
    where: { orderCode: pending.order_code },
    data: { firstProofAt: new Date(Date.now() - 49 * 3600000) },
  });
  await backdateHold(db, pending.order_code, 60000);
  await expireHolds();
  data = await status(pending);
  expect(data.status).toBe("EXPIRED");
  expect(data.pending_proof).toBe(true);
  expect(data.late_proof_received).toBeUndefined();
  expect(data.can_submit_proof).toBe(false);
});
test("approved on-demand PDF works before email; refund/voided tickets lose download eligibility", async () => {
  const f = await fresh();
  await proof(f);
  const order = await row(f);
  const owner = await db.staffUser.findFirstOrThrow({
    where: { role: "OWNER" },
  });
  await approveOrder(order.id, owner.id);
  let data = await status(f);
  expect(data.status).toBe("APPROVED");
  expect(data.can_submit_proof).toBe(false);
  expect(data.tickets).toHaveLength(1);
  expect(data.tickets[0].voided).toBe(false);
  const url = data.tickets[0].pdf_url;
  const pdf = await api(url);
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  await db.ticketUnit.update({
    where: { id: data.tickets[0].ticket_id },
    data: { voidedAt: new Date() },
  });
  expect((await status(f)).tickets[0].voided).toBe(true);
  expect((await api(url)).status).toBe(410);
  await refundOrder(order.id, owner.id, {
    restock: false,
    acknowledge_checked_in: false,
  });
  data = await status(f);
  expect(data.status).toBe("REFUNDED");
  expect(data.tickets).toBeUndefined();
  expect((await api(url)).status).toBe(410);
});
