import { beforeAll, test, expect } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { api, login, createStaffUser, makeJpeg, submitProof } from "../phase3b/helpers";
import { orderFixture, approvedOrder } from "../phase4/fixtures";
import { deriveStatusToken } from "@/lib/orders/status-token";
import { getTicketPdf, pdfCacheKey, ticketPdfInputs, renderTicketPdf } from "@/lib/tickets/pdf";
import { getStorage } from "@/lib/storage";
import { storageReport } from "@/lib/storage/report";
import { storeNewImage } from "@/lib/storage/accounting";
import { IMAGE_FILE_BYTES, PDF_OBJECT_BYTES } from "@/lib/uploads/limits";

let owner: Awaited<ReturnType<typeof login>>;
let staff: Awaited<ReturnType<typeof login>>;
const token = (order: { id: string; statusTokenVersion: number }) => deriveStatusToken(order.id, order.statusTokenVersion);
async function control(command: unknown) {
  const response = await fetch(process.env.SUPABASE_URL + "/control", { method: "POST", headers: { "x-fixture-control": process.env.FAKE_STORAGE_CONTROL_KEY!, "content-type": "application/json" }, body: JSON.stringify(command) });
  return response.json() as Promise<{ count: number }>;
}
async function awaiting() {
  const f = await orderFixture(1, false);
  await db.paymentProof.deleteMany({ where: { orderId: f.order.id } });
  f.order = await db.order.update({ where: { id: f.order.id }, data: { status: "AWAITING_PAYMENT", proofAttempts: 0, holdExpiresAt: new Date(Date.now() + 3600_000) } });
  return f;
}
beforeAll(async () => {
  owner = await login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
  const email = `storage-staff-${randomUUID()}@example.test`;
  await createStaffUser(email, "Storage-Fixture-Password", "STAFF"); staff = await login(email, "Storage-Fixture-Password");
  // Compile the new proof path before timing-sensitive cases. Identical public denial path.
  expect((await submitProof({ orderCode: "SR-WARMUP", statusToken: "missing", reference: "warm", ip: "10.7.0.1" })).status).toBe(404);
}, 120_000);

test("proof provider failure preserves attempts/inventory; same-ID retry links one sanitized object and retains uploaded hash", async () => {
  const f = await awaiting(); const bytes = await makeJpeg(); const submissionId = randomUUID(); const reference = randomUUID();
  const input = { orderCode: f.order.orderCode, statusToken: token(f.order), reference, submissionId, file: bytes, mimeType: "image/png", ip: "10.7.0.2" };
  await control({ fault: { operation: "put", status: 503, once: true } });
  expect((await submitProof(input)).status).toBe(503);
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order.id } })).proofAttempts).toBe(0);
  expect((await db.ticketTier.findUniqueOrThrow({ where: { id: f.tier.id } })).reserved).toBe(1);
  expect(await db.storageObject.count({ where: { state: "UPLOADING", lastError: "PROVIDER", key: { startsWith: `proofs/${f.order.id}/` } } })).toBe(1);
  const results = await Promise.all([submitProof(input), submitProof(input)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId: f.order.id } });
  expect(await db.paymentProof.count({ where: { orderId: f.order.id } })).toBe(1);
  expect(proof.fileSha256).toBe(createHash("sha256").update(bytes).digest("hex")); expect(proof.mimeType).toBe("image/jpeg");
  const ledger = await db.storageObject.findUniqueOrThrow({ where: { key: proof.storagePath } });
  const stored = await getStorage().getObject(proof.storagePath);
  expect(ledger.state).toBe("LINKED"); expect(ledger.linkedEntityId).toBe(f.order.id);
  expect(ledger.storedBytes).toBe(BigInt(stored!.bytes.length)); expect(ledger.storedSha256).toBe(createHash("sha256").update(stored!.bytes).digest("hex"));
  expect(Number(ledger.storedBytes)).toBeLessThanOrEqual(IMAGE_FILE_BYTES);
}, 90_000);

test("immutable concurrent real PDFs return the same stored winner; missing regenerates, outage cannot overwrite/cache-disappear", async () => {
  const f = await approvedOrder(1); const id = f.tickets[0].id;
  const [first, peer] = await Promise.all([getTicketPdf(id), getTicketPdf(id)]);
  expect(first.key).toBe(peer.key); expect(first.bytes).toEqual(peer.bytes);
  expect((await db.storageObject.findUniqueOrThrow({ where: { key: first.key } })).state).toBe("LINKED");
  await control({ fault: { operation: "authenticated", status: 500, once: true } });
  await expect(getTicketPdf(id)).rejects.toThrow("Storage temporarily unavailable");
  expect((await db.ticketUnit.findUniqueOrThrow({ where: { id } })).pdfUrl).toBe(first.key);
  expect((await getTicketPdf(id)).bytes).toEqual(first.bytes);
  await control({ remove: `sr-private/${first.key}` });
  expect((await getTicketPdf(id)).key).toBe(first.key);
  await db.venue.update({ where: { id: f.venue.id }, data: { name: "Updated venue" } });
  const changed = await getTicketPdf(id); expect(changed.key).not.toBe(first.key);
  expect((await getStorage().getObject(first.key))!.bytes.length).toBeGreaterThan(0);
  await control({ corrupt: `sr-private/${changed.key}` }); await expect(getTicketPdf(id)).rejects.toThrow();
}, 90_000);

test("private remote proof/PDF gates stay application-only; OWNER signature expiry, STAFF, tokens, refunds and voids", async () => {
  const f = await awaiting(); expect((await submitProof({ orderCode: f.order.orderCode, statusToken: token(f.order), reference: randomUUID(), ip: "10.7.0.3" })).status).toBe(200);
  const detail = await api(`/api/admin/orders/${f.order.id}`, { cookies: owner.cookies }); const payload = await detail.text();
  expect(detail.status).toBe(200); expect(payload).not.toContain(process.env.SUPABASE_URL!); expect(payload).not.toContain("storage_path");
  const parsed = JSON.parse(payload); const url = parsed.proofs[0].image_url as string;
  expect(url).toStartWith("/api/admin/storage/object?");
  expect((await api(url)).status).toBe(401); expect((await api(url, { cookies: staff.cookies })).status).toBe(403);
  const image = await api(url, { cookies: owner.cookies }); expect(image.status).toBe(200); expect(image.headers.get("cache-control")).toContain("no-store");
  const tampered = new URL(url, "http://localhost"); tampered.searchParams.set("sig", "x".repeat(43)); expect((await api(tampered.pathname + tampered.search, { cookies: owner.cookies })).status).toBe(403);
  const expired = new URL(url, "http://localhost"); expired.searchParams.set("exp", "1"); expect((await api(expired.pathname + expired.search, { cookies: owner.cookies })).status).toBe(410);
  const approved = await approvedOrder(1); const path = `/api/orders/${approved.order.orderCode}/tickets/${approved.tickets[0].id}/pdf?t=${token(approved.order)}`;
  expect((await api(path)).status).toBe(200);
  await db.order.update({ where: { id: approved.order.id }, data: { statusTokenVersion: { increment: 1 } } }); expect((await api(path)).status).toBe(404);
  const current = await db.order.findUniqueOrThrow({ where: { id: approved.order.id } }); const newPath = path.split("?")[0] + "?t=" + token(current);
  await db.ticketUnit.update({ where: { id: approved.tickets[0].id }, data: { voidedAt: new Date() } }); expect((await api(newPath)).status).toBe(410);
  await db.ticketUnit.update({ where: { id: approved.tickets[0].id }, data: { voidedAt: null } }); await db.order.update({ where: { id: approved.order.id }, data: { status: "REFUNDED" } }); expect((await api(newPath)).status).toBe(410);
  expect((await api("/api/banners/not-a-proof.jpg")).status).toBe(404);
}, 90_000);

test("rollback/crash/replaced/unknown references stay reconcilable; dry-run pagination/privacy/grace never deletes", async () => {
  const f = await awaiting(); const key = await storeNewImage(() => `proofs/${f.order.id}/${randomUUID()}.jpg`, await makeJpeg(), "image/jpeg");
  // Uploaded bytes without a committed business pointer: simulate a process stopping before linking.
  await db.storageObject.update({ where: { key }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  let next = ""; let item: Awaited<ReturnType<typeof storageReport>>["items"][number] | undefined;
  do { const report = await storageReport(next); item ??= report.items.find(row => row.key === key); next = report.next ?? ""; } while (next);
  expect(item!.flags).toContain("ORPHAN_CANDIDATE"); expect(item!.deletion_allowed).toBe(false);
  const before = await control({}); expect((await api("/api/admin/storage/report")).status).toBe(401); expect((await api("/api/admin/storage/report", { cookies: staff.cookies })).status).toBe(403);
  const report = await api("/api/admin/storage/report", { cookies: owner.cookies }); expect(report.status).toBe(200); expect(report.headers.get("cache-control")).toContain("no-store");
  expect((await report.json()).deletion_allowed).toBe(false); expect((await control({})).count).toBe(before.count);
  await expect(db.$transaction(async tx => { await tx.storageObject.update({ where: { key }, data: { state: "LINKED", linkedEntityId: f.order.id, linkedEntityType: "ORDER" } }); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect((await db.storageObject.findUniqueOrThrow({ where: { key } })).state).toBe("STORED");
}, 90_000);

test("maximum legitimate ticket text remains inside the 1 MiB artifact cap", async () => {
  const f = await approvedOrder(1); const { input } = await ticketPdfInputs(f.tickets[0].id);
  const bytes = (await renderTicketPdf({ ...input, event: "Ọ".repeat(200), venue: "é".repeat(200), address: "a".repeat(1000), tier: "t".repeat(200), holder: "Chloé Ọlá ".repeat(20), directions: "https://www.google.com/maps/dir/?api=1&destination=" + "d".repeat(2000) })).bytes;
  expect(bytes.length).toBeLessThanOrEqual(PDF_OBJECT_BYTES); expect(await pdfCacheKey(input)).toMatch(/tickets\/.+\/[0-9a-f]{64}\.pdf$/);
}, 90_000);
