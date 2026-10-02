import "../phase3b/load-env";
import { beforeEach, afterAll, test, expect } from "bun:test";
import { db } from "@/lib/db";
import { processEmailJobs } from "@/lib/email/worker";
import { EMAIL } from "@/lib/email/config";
import { openPayload } from "@/lib/email/payload";
import type { EmailPayload, EmailTransport, SendOutcome } from "@/lib/email/transport";
let time: number;
beforeEach(async () => {
  time = Date.now();
  await db.emailJob.deleteMany();
  await db.emailWorkerGate.update({ where: { id: "email" }, data: { owner: null, leaseUntil: new Date(0), nextSendAt: new Date(0) } });
});
afterAll(() => db.$disconnect());
async function job(kind: "STATUS_LINK" | "TICKETS" = "STATUS_LINK", status: "APPROVED" | "REFUNDED" = "APPROVED") {
  const event = await db.event.findFirstOrThrow(); const account = await db.paymentAccount.findFirstOrThrow();
  const order = await db.order.create({ data: { orderCode: `SR-${crypto.randomUUID().slice(0, 8)}`, eventId: event.id, customerName: "Test", customerEmail: "real-order@example.test", customerPhone: "08012345678", totalKobo: 0, paymentAccountId: account.id, holdExpiresAt: new Date(), status } });
  return db.emailJob.create({ data: { orderId: order.id, kind, recipientEmail: "injected@example.test", nextAttemptAt: new Date(time - 1000) } });
}
const build = async (): Promise<EmailPayload> => ({ from: "a@example.test", reply_to: "b@example.test", to: ["evil@example.test"], subject: "Fixed", html: "<p>stable</p>", text: "stable", attachments: [], tags: [] });
function options(transport: EmailTransport) { return { transport, now: () => time, sleep: async (ms: number) => { time += ms; }, random: () => 0.5, buildPayload: build }; }
function fake(outcome: SendOutcome): EmailTransport { return { send: async () => outcome }; }
const success = { ok: true as const, messageId: "fake-message" };
test("worker success QUEUED -> SENT, stores message id, attempts=1; only order recipient", async () => {
  const j = await job();
  await processEmailJobs(options({ send: async (id, p) => { expect(id).toBe(j.id); expect(p.to).toEqual(["real-order@example.test"]); expect(p.tags).toEqual([{ name: "job_id", value: j.id }]); return success; } }));
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.status).toBe("SENT"); expect(saved.attempts).toBe(1); expect(saved.resendMessageId).toBe("fake-message");
  expect(saved.encryptedPayload).not.toContain("real-order@example.test");
});
test("worker transient 500 queues 1m backoff; MAX_EMAIL_ATTEMPTS fails", async () => {
  const j = await job(); const t = fake({ ok: false, transient: true, code: "HTTP_500" });
  const started = time;
  await processEmailJobs(options(t));
  let saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.status).toBe("QUEUED"); expect(saved.attempts).toBe(1); expect(saved.nextAttemptAt.getTime()).toBe(started + 60_000);
  await db.emailJob.update({ where: { id: j.id }, data: { attempts: 5, nextAttemptAt: new Date(time) } });
  await processEmailJobs(options(t)); saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.status).toBe("FAILED"); expect(saved.attempts).toBe(6);
});
test("permanent 422 fails immediately; last_error excludes URLs/tokens/addresses", async () => {
  const j = await job(); await processEmailJobs(options(fake({ ok: false, transient: false, code: "HTTP_422 https://evil/?t=secret buyer@test.ng" })));
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.status).toBe("FAILED"); expect(saved.lastError).toBe("PAYLOAD_ERROR"); expect(saved.attempts).toBe(1);
});
test("429 Retry-After honoured; quota pauses batch and shared gate", async () => {
  const j = await job(); const other = await job();
  await processEmailJobs(options(fake({ ok: false, transient: true, code: "HTTP_429", retryAfterMs: 120_000, quota: true })));
  expect((await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).nextAttemptAt.getTime()).toBe(time + 120_000);
  expect((await db.emailJob.findUniqueOrThrow({ where: { id: other.id } })).attempts).toBe(0);
  expect((await processEmailJobs(options(fake(success)))).paused).toBe(true);
});
test("crash after acceptance retries SAME key and payload, one effective send", async () => {
  const j = await job(); const accepted = new Map<string, string>(); let effective = 0;
  const t = { send: async (id: string, p: EmailPayload) => { const body = JSON.stringify(p); if (!accepted.has(id)) { accepted.set(id, body); effective++; } else expect(accepted.get(id)).toBe(body); return success; } };
  await expect(processEmailJobs({ ...options(t), afterAccepted: async () => { throw new Error("SIMULATED_CRASH"); } })).rejects.toThrow("SIMULATED_CRASH");
  await db.emailJob.update({ where: { id: j.id }, data: { nextAttemptAt: new Date(time - 1) } });
  await processEmailJobs({ ...options(t), buildPayload: async () => { throw new Error("must reuse"); } });
  expect(effective).toBe(1); expect((await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).attempts).toBe(2);
});
test("two concurrent workers send each job once; shared spacing persists across invocations", async () => {
  await job(); await job(); const calls: number[] = [];
  const t = { send: async () => { calls.push(time); return success; } };
  await Promise.all([processEmailJobs({ ...options(t), limit: 1 }), processEmailJobs({ ...options(t), limit: 1 })]);
  await processEmailJobs(options(t));
  expect(calls.length).toBe(2); expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(600);
  expect(await db.emailJob.count({ where: { status: "SENT", attempts: 1 } })).toBe(2);
});
test("stuck expired claim reclaimed; live lease skipped; refunded ticket job never sends", async () => {
  const live = await job(); const expired = await job(); const refunded = await job("TICKETS", "REFUNDED");
  await db.emailJob.update({ where: { id: live.id }, data: { nextAttemptAt: new Date(time + 300_000), claimToken: crypto.randomUUID() } });
  await db.emailJob.update({ where: { id: expired.id }, data: { nextAttemptAt: new Date(time - 1000), claimToken: crypto.randomUUID(), attempts: 1 } });
  let sends = 0; await processEmailJobs(options({ send: async () => { sends++; return success; } }));
  expect(sends).toBe(1); expect((await db.emailJob.findUniqueOrThrow({ where: { id: expired.id } })).attempts).toBe(2);
  expect((await db.emailJob.findUniqueOrThrow({ where: { id: live.id } })).attempts).toBe(0);
  expect((await db.emailJob.findUniqueOrThrow({ where: { id: refunded.id } })).lastError).toBe("ORDER_NOT_APPROVED");
});
test("expired ownership after slow preparation blocks provider; no late batch lease send", async () => {
  const j = await job(); let sends = 0;
  await processEmailJobs({ ...options({ send: async () => { sends++; return success; } }), buildPayload: async () => { time += EMAIL.leaseMs + 1; return build(); } });
  expect(sends).toBe(0); expect((await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("QUEUED");
});
test("ambiguous outcomes after retention stop; immutable payload guards token rotation", async () => {
  const j = await job(); await db.emailJob.update({ where: { id: j.id }, data: { firstSendAt: new Date(time - EMAIL.retentionMs) } });
  await processEmailJobs(options(fake(success))); expect((await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).lastError).toBe("DELIVERY_UNCERTAIN");
  const other = await job(); await processEmailJobs(options(fake({ ok: false, transient: true, code: "HTTP_500" })));
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: other.id } });
  expect(openPayload(other.id, saved.encryptedPayload!).to).toEqual(["real-order@example.test"]);
  await db.order.update({ where: { id: other.orderId }, data: { statusTokenVersion: { increment: 1 } } });
  await db.emailJob.update({ where: { id: other.id }, data: { nextAttemptAt: new Date(time - 1) } });
  await processEmailJobs(options(fake(success))); expect((await db.emailJob.findUniqueOrThrow({ where: { id: other.id } })).lastError).toBe("TOKEN_VERSION_CHANGED");
});
test("webhook winning during send retains BOUNCED while message id is persisted", async () => {
  const j = await job(); await processEmailJobs(options({ send: async () => {
    await db.emailJob.update({ where: { id: j.id }, data: { status: "BOUNCED" } }); return success;
  } }));
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(saved.status).toBe("BOUNCED"); expect(saved.resendMessageId).toBe("fake-message");
});
test("immutable retry payload refuses changed order recipient and ciphertext tampering", async () => {
  const j = await job(); await processEmailJobs(options(fake({ ok: false, transient: true, code: "HTTP_500" })));
  await db.order.update({ where: { id: j.orderId }, data: { customerEmail: "changed@example.test" } });
  await db.emailJob.update({ where: { id: j.id }, data: { nextAttemptAt: new Date(time - 1) } });
  await processEmailJobs(options(fake(success))); expect((await db.emailJob.findUniqueOrThrow({ where: { id: j.id } })).lastError).toBe("RECIPIENT_CHANGED");
  const saved = await db.emailJob.findUniqueOrThrow({ where: { id: j.id } });
  expect(() => openPayload(crypto.randomUUID(), saved.encryptedPayload!)).toThrow();
});
