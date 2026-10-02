import "../phase3b/load-env";
import { test, expect } from "bun:test";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import { api, BASE } from "../phase3b/helpers";
import { approvedOrder } from "./fixtures";
async function post(event: unknown, opts: { time?: Date; invalid?: boolean; missing?: boolean } = {}) {
  const raw = typeof event === "string" ? event : JSON.stringify(event); const id = `msg_${crypto.randomUUID()}`; const time = opts.time ?? new Date();
  const headers: Record<string, string> = opts.missing ? {} : { "svix-id": id, "svix-timestamp": String(Math.floor(time.getTime() / 1000)), "svix-signature": opts.invalid ? "v1,invalid" : new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, time, raw) };
  return fetch(BASE + "/api/webhooks/resend", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: raw });
}
test("webhook valid signature/tag-before-message-id, replay no-op, bounce wins over delivery", async () => {
  const f = await approvedOrder(1); const job = await db.emailJob.findFirstOrThrow({ where: { orderId: f.order.id } });
  const delivered = { type: "email.delivered", data: { email_id: "fixture-delivered", tags: { job_id: job.id } } };
  expect((await post(delivered)).status).toBe(200); let saved = await db.emailJob.findUniqueOrThrow({ where: { id: job.id } }); expect(saved.status).toBe("DELIVERED"); expect(saved.resendMessageId).toBe("fixture-delivered");
  const updated = saved.updatedAt.getTime(); expect((await post(delivered)).status).toBe(200); expect((await db.emailJob.findUniqueOrThrow({ where: { id: job.id } })).updatedAt.getTime()).toBe(updated);
  expect((await post({ type: "email.bounced", data: { email_id: "fixture-delivered" } })).status).toBe(200);
  expect((await post(delivered)).status).toBe(200); saved = await db.emailJob.findUniqueOrThrow({ where: { id: job.id } }); expect(saved.status).toBe("BOUNCED");
});
test("webhook missing/invalid/stale/future signatures rejected; malformed JSON and oversized body", async () => {
  const event = { type: "email.delivered", data: { email_id: "unmatched" } };
  expect((await post(event, { missing: true })).status).toBe(401); expect((await post(event, { invalid: true })).status).toBe(401);
  expect((await post(event, { time: new Date(Date.now() - 301_000) })).status).toBe(401); expect((await post(event, { time: new Date(Date.now() + 301_000) })).status).toBe(401);
  expect((await post("{" )).status).toBe(400); expect((await post("x".repeat(65537))).status).toBe(413);
  expect((await post(event)).status).toBe(404); expect((await post({ type: "email.opened" })).status).toBe(200);
});
test("webhook raw-body tampering fails; array job_id tag matches before stored id", async () => {
  const f = await approvedOrder(1); const job = await db.emailJob.findFirstOrThrow({ where: { orderId: f.order.id } });
  expect((await post({ type: "email.bounced", data: { email_id: "fixture-array", tags: [{ name: "job_id", value: job.id }] } })).status).toBe(200);
  const raw = JSON.stringify({ type: "email.opened" }); const time = new Date(); const id = "msg_fixture"; const signature = new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, time, raw);
  const r = await fetch(BASE + "/api/webhooks/resend", { method: "POST", body: raw + " ", headers: { "svix-id": id, "svix-timestamp": String(Math.floor(time.getTime() / 1000)), "svix-signature": signature } }); expect(r.status).toBe(401);
});
test("process endpoint wrong/missing CRON_SECRET 401; correct drains capture job", async () => {
  expect((await api("/api/internal/process-email-jobs", { body: {} })).status).toBe(401);
  expect((await api("/api/internal/process-email-jobs", { body: {}, headers: { "x-cron-secret": "wrong" } })).status).toBe(401);
  await db.emailJob.updateMany({ where: { status: "QUEUED" }, data: { nextAttemptAt: new Date(Date.now() + 600_000) } });
  await db.emailWorkerGate.update({ where: { id: "email" }, data: { nextSendAt: new Date(0), leaseUntil: new Date(0), owner: null } });
  const f = await approvedOrder(1); await db.emailJob.updateMany({ where: { orderId: f.order.id }, data: { nextAttemptAt: new Date(Date.now() + 600_000) } });
  const job = await db.emailJob.create({ data: { orderId: f.order.id, kind: "STATUS_LINK", recipientEmail: "injected@example.test" } });
  const r = await api("/api/internal/process-email-jobs", { body: {}, headers: { "x-cron-secret": process.env.CRON_SECRET! } }); expect(r.status).toBe(200); expect((await r.json()).sent).toBe(1);
  expect((await db.emailJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("SENT");
});
