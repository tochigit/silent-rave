import { test, expect } from "bun:test";
import { db } from "./fixture-db";
import { api, login, OWNER_EMAIL, OWNER_PASSWORD } from "./phase3b/helpers";
import { orderFixture } from "./phase4/fixtures";
test("real HTTP approve/reject succeed with kicks enabled and worker configuration failure", async () => {
  expect(process.env.EMAIL_KICK_ENABLED).toBe("1"); expect(process.env.EMAIL_FROM).toBe("");
  const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  for (const action of ["approve", "reject"]) {
    const f = await orderFixture(1, false);
    const r = await api(`/api/admin/orders/${f.order.id}/${action}`, { host: "admin.localhost:3000", origin: "http://admin.localhost:3000", cookies: owner.cookies, body: action === "approve" ? { confirmed_in_bank: true } : { reason_code: "UNREADABLE", message: "Please resubmit.", final: false } });
    expect(r.status).toBe(200);
    const saved = await db.order.findUniqueOrThrow({ where: { id: f.order.id } }); expect(saved.status).toBe(action === "approve" ? "APPROVED" : "NEEDS_RESUBMIT");
    const jobs = await db.emailJob.findMany({ where: { orderId: f.order.id } }); expect(jobs).toHaveLength(1); expect(jobs[0].status).toBe("QUEUED");
  }
});
test("missing configured CRON_SECRET/webhook secret fail closed over real HTTP", async () => {
  expect((await api("/api/internal/process-email-jobs", { body: {}, headers: { "x-cron-secret": "anything" } })).status).toBe(401);
  expect((await api("/api/webhooks/resend", { body: { type: "email.delivered" } })).status).toBe(503);
});
