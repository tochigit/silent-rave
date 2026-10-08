import { beforeAll, test, expect } from "bun:test";
import { db } from "../fixture-db";
import { api, login, createStaffUser, OWNER_EMAIL, OWNER_PASSWORD, type Session } from "../phase3b/helpers";
import { deriveStatusToken } from "@/lib/orders/status-token";
import { processEmailJobs } from "@/lib/email/worker";
import { approvedOrder } from "./fixtures";
let owner: Session, staff: Session;
beforeAll(async () => {
  owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const email = "phase4staff@example.test"; await createStaffUser(email, "fixture-staff", "STAFF"); staff = await login(email, "fixture-staff");
});
const admin = (body: unknown = {}) => ({ host: "admin.localhost:3000", origin: "http://admin.localhost:3000", cookies: owner.cookies, body });
const refund = (id: string, restock = false, acknowledge_checked_in = false) => api(`/api/admin/orders/${id}/refund`, admin({ password: OWNER_PASSWORD, restock, acknowledge_checked_in }));
const pdfPath = (code: string, ticketId: string, token?: string) => `/api/orders/${code}/tickets/${ticketId}/pdf${token ? `?t=${token}` : ""}`;
test("PDF authz: unknown order/ticket, wrong order/token and missing token are identical 404; headers/status links", async () => {
  const f = await approvedOrder(1); const other = await approvedOrder(1); const token = deriveStatusToken(f.order.id, f.order.statusTokenVersion);
  const paths = [pdfPath("SR-UNKNOWN", f.tickets[0].id, token), pdfPath(f.order.orderCode, crypto.randomUUID(), token), pdfPath(f.order.orderCode, other.tickets[0].id, token), pdfPath(f.order.orderCode, f.tickets[0].id, "wrong"), pdfPath(f.order.orderCode, f.tickets[0].id)];
  const bodies: string[] = [];
  for (const p of paths) { const r = await api(p); expect(r.status).toBe(404); bodies.push(await r.text()); expect(r.headers.get("referrer-policy")).toBe("no-referrer"); }
  expect(new Set(bodies).size).toBe(1);
  const r = await api(pdfPath(f.order.orderCode, f.tickets[0].id, token)); expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe("application/pdf"); expect(r.headers.get("content-disposition")).toStartWith("attachment;"); expect(r.headers.get("cache-control")).toBe("private, no-store"); expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  const status = await api(`/api/orders/${f.order.orderCode}/status`, { headers: { "x-status-token": token } }); const body = await status.json();
  expect(body.tickets[0].pdf_url).toBe(pdfPath(f.order.orderCode, f.tickets[0].id, token)); expect(JSON.stringify(body)).not.toMatch(/tickets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf/);
  await db.order.update({ where: { id: f.order.id }, data: { status: "PROOF_SUBMITTED" } }); expect((await api(pdfPath(f.order.orderCode, f.tickets[0].id, token))).status).toBe(409);
  await db.order.update({ where: { id: f.order.id }, data: { status: "APPROVED" } }); await db.ticketUnit.update({ where: { id: f.tickets[0].id }, data: { voidedAt: new Date() } }); expect((await api(pdfPath(f.order.orderCode, f.tickets[0].id, token))).status).toBe(410);
});
test("refund voids all units and bumps sync_seq; restock/audit; repeat/concurrent refund restocks once", async () => {
  const f = await approvedOrder(2);
  const rs = await Promise.all([refund(f.order.id, true), refund(f.order.id, true)]); expect(rs.map(r => r.status)).toEqual([200, 200]);
  expect((await Promise.all(rs.map(r => r.json()))).filter(r => !r.idempotent)).toHaveLength(1);
  expect((await db.ticketTier.findUniqueOrThrow({ where: { id: f.tier.id } })).sold).toBe(0);
  for (const old of f.tickets) { const current = await db.ticketUnit.findUniqueOrThrow({ where: { id: old.id } }); expect(current.voidedAt).not.toBeNull(); expect(current.syncSeq).toBeGreaterThan(old.syncSeq); }
  expect((await refund(f.order.id, true)).status).toBe(200);
  const audits = await db.auditLogEntry.findMany({ where: { action: "ORDER_REFUNDED", entityId: f.order.id } }); expect(audits).toHaveLength(1); expect(audits[0].actorId).toBe(owner.userId); expect(audits[0].metadata).toEqual({ restock: true, acknowledge_checked_in: false, note: null });
  const token = deriveStatusToken(f.order.id, 1); expect((await api(pdfPath(f.order.orderCode, f.tickets[0].id, token))).status).toBe(410);
  const status = await (await api(`/api/orders/${f.order.orderCode}/status?t=${token}`)).json(); expect(status.status).toBe("REFUNDED"); expect(status.tickets).toBeUndefined();
  expect((await api(`/api/admin/orders/${f.order.id}/resend-tickets`, admin())).status).toBe(409);
  const job = await db.emailJob.findFirstOrThrow({ where: { orderId: f.order.id, kind: "TICKETS" } });
  // Test only this queued job; other fixture jobs must not mask the assertion.
  await db.emailJob.updateMany({ where: { id: { not: job.id }, status: "QUEUED" }, data: { nextAttemptAt: new Date(Date.now() + 600_000) } });
  await db.emailWorkerGate.update({ where: { id: "email" }, data: { nextSendAt: new Date(0) } });
  let sent = 0; await processEmailJobs({ transport: { send: async () => { sent++; return { ok: true, messageId: "forbidden" }; } } });
  expect(sent).toBe(0); expect((await db.emailJob.findUniqueOrThrow({ where: { id: job.id } })).lastError).toBe("ORDER_NOT_APPROVED");
});
test("refund restock=false preserves sold; undercount clamp never negative; non-approved 409", async () => {
  const f = await approvedOrder(); await refund(f.order.id); expect((await db.ticketTier.findUniqueOrThrow({ where: { id: f.tier.id } })).sold).toBe(2);
  const lower = await approvedOrder(); await db.ticketTier.update({ where: { id: lower.tier.id }, data: { sold: 1 } }); await refund(lower.order.id, true); expect((await db.ticketTier.findUniqueOrThrow({ where: { id: lower.tier.id } })).sold).toBe(0);
  const pending = await approvedOrder(1); await db.order.update({ where: { id: pending.order.id }, data: { status: "PROOF_SUBMITTED" } }); expect((await refund(pending.order.id)).status).toBe(409);
});
test("checked-in refund needs acknowledgement, then succeeds with audit", async () => {
  const f = await approvedOrder(1); await db.ticketUnit.update({ where: { id: f.tickets[0].id }, data: { checkInStatus: "CHECKED_IN", checkedInAt: new Date() } });
  const denied = await refund(f.order.id); expect(denied.status).toBe(409); expect((await denied.json()).code).toBe("CHECKED_IN_TICKETS");
  expect((await refund(f.order.id, false, true)).status).toBe(200); const audit = await db.auditLogEntry.findFirstOrThrow({ where: { entityId: f.order.id, action: "ORDER_REFUNDED" } }); expect((audit.metadata as { acknowledge_checked_in: boolean }).acknowledge_checked_in).toBe(true);
});
test("refund/resend OWNER matrix: STAFF 403, anonymous 401, bad Origin 403; password re-entry", async () => {
  const f = await approvedOrder(1);
  for (const action of ["refund", "resend-tickets"]) {
    const p = `/api/admin/orders/${f.order.id}/${action}`;
    expect((await api(p, { ...admin(), cookies: staff.cookies })).status).toBe(403);
    expect((await api(p, { ...admin(), cookies: {} })).status).toBe(401);
    expect((await api(p, { ...admin(), origin: "https://evil.test" })).status).toBe(403);
  }
  expect((await api(`/api/admin/orders/${f.order.id}/refund`, admin())).status).toBe(400);
  expect((await api(`/api/admin/orders/${f.order.id}/refund`, admin({ password: "wrong" }))).status).toBe(403);
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).status).toBe("APPROVED");
});
test("resends fresh keys/order recipient/audits; sixth in sliding hour rate-limited; rejects recipient input", async () => {
  const f = await approvedOrder(1); const p = `/api/admin/orders/${f.order.id}/resend-tickets`;
  expect((await api(p, admin({ recipient_email: "evil@example.test" }))).status).toBe(400);
  for (let i = 0; i < 5; i++) expect((await api(p, admin())).status).toBe(200);
  expect((await api(p, admin())).status).toBe(429);
  const jobs = await db.emailJob.findMany({ where: { orderId: f.order.id, dedupeKey: { startsWith: "resend-" } } }); expect(jobs).toHaveLength(5); expect(new Set(jobs.map(j => j.dedupeKey)).size).toBe(5);
  for (const j of jobs) expect(j.recipientEmail).toBe(f.order.customerEmail);
  expect(await db.auditLogEntry.count({ where: { entityId: f.order.id, action: "TICKET_RESENT" } })).toBe(5);
  await db.auditLogEntry.updateMany({ where: { entityId: f.order.id, action: "TICKET_RESENT" }, data: { createdAt: new Date(Date.now() - 3_600_001) } });
  expect((await api(p, admin())).status).toBe(200); // backdate fixture only; production has no audit mutation
});
test("concurrent resend limit across requests admits exactly five", async () => {
  const f = await approvedOrder(1); const p = `/api/admin/orders/${f.order.id}/resend-tickets`;
  const responses = await Promise.all(Array.from({ length: 6 }, () => api(p, admin())));
  expect(responses.filter(r => r.status === 200)).toHaveLength(5); expect(responses.filter(r => r.status === 429)).toHaveLength(1);
});
test("owner email-jobs filters/pagination and order-detail jobs contain no links/tokens/private payload", async () => {
  const f = await approvedOrder(1);
  await db.emailJob.create({ data: { orderId: f.order.id, kind: "STATUS_LINK", recipientEmail: f.order.customerEmail, status: "FAILED", lastError: "https://example.test/?t=token buyer@example.test", encryptedPayload: "private" } });
  const p = `/api/admin/email-jobs?order_id=${f.order.id}&status=FAILED&limit=1&page=1`;
  expect((await api(p, { cookies: {} })).status).toBe(401); expect((await api(p, { cookies: staff.cookies })).status).toBe(403);
  const body = await (await api(p, { cookies: owner.cookies })).json(); expect(body.jobs).toHaveLength(1); expect(body.pagination.total).toBe(1); expect(body.jobs[0].last_error).toBe("PAYLOAD_ERROR");
  const detail = await (await api(`/api/admin/orders/${f.order.id}`, { cookies: owner.cookies })).json(); expect(detail.email_jobs).toHaveLength(2);
  for (const value of [body.jobs, detail.email_jobs]) { const text = JSON.stringify(value); for (const forbidden of ["https://", "token", "encryptedPayload", "recipientEmail", "private", "qr"]) expect(text).not.toContain(forbidden); }
  expect((await api("/api/admin/email-jobs?page=0", { cookies: owner.cookies })).status).toBe(400);
});
