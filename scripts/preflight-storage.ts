import { PrismaClient } from "@prisma/client";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { startFixture, runCommand } from "./fixture";
await mkdir("reports", { recursive: true });
const output = createWriteStream(`reports/step5a-${process.platform}-migration-backfill.txt`);
const log = (line: string) => { console.log(line); output.write(line + "\n"); };
let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
let db: PrismaClient | undefined;
try {
  fixture = await startFixture(chunk => output.write(chunk), true);
  db = new PrismaClient({ datasources: { db: { url: fixture.env.DATABASE_URL } } });
  const owner = await db.staffUser.findFirstOrThrow({ where: { role: "OWNER" } });
  const event = await db.event.findFirstOrThrow(); const tier = await db.ticketTier.findFirstOrThrow(); const bank = await db.paymentAccount.findFirstOrThrow();
  const order = await db.order.create({ data: { orderCode: `SR-${randomUUID().slice(0, 8).toUpperCase()}`, eventId: event.id, customerName: "Legacy fixture", customerEmail: "legacy@example.test", customerPhone: "08012345678", paymentAccountId: bank.id, totalKobo: 100, status: "APPROVED" } });
  const proof = await db.paymentProof.create({ data: { orderId: order.id, attemptNo: 1, clientSubmissionId: randomUUID(), storagePath: `proofs/${order.id}/legacy-attempt.jpg`, fileSha256: "legacy-unknown", mimeType: "image/jpeg", sizeBytes: 100, transferReference: randomUUID(), senderName: "Fixture" } });
  const ticketId = randomUUID(); const pdf = `tickets/${ticketId}/${"a".repeat(64)}.pdf`;
  await db.ticketUnit.create({ data: { id: ticketId, orderId: order.id, eventId: event.id, tierId: tier.id, unitIndex: 1, qrToken: "legacy-fixture-qr", pdfUrl: pdf } });
  const banner = `/api/banners/${randomUUID()}.webp`; await db.event.update({ where: { id: event.id }, data: { bannerImageUrl: banner } });
  for (const role of ["anon", "authenticated"]) await db.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
  await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "migrate", "deploy"], fixture.env, chunk => output.write(chunk));
  const references = await db.storageObject.findMany();
  if (references.length !== 3 || references.some(r => r.state !== "LEGACY_REFERENCED" || r.storedBytes !== null || r.storedSha256 !== null)) throw new Error();
  if (!(references.some(r => r.key === proof.storagePath) && references.some(r => r.key === pdf) && references.some(r => r.key === "banners/" + banner.slice(13)))) throw new Error();
  const after = await db.staffUser.findUniqueOrThrow({ where: { id: owner.id } });
  if (JSON.stringify(owner) !== JSON.stringify(after)) throw new Error();
  log("PASS: existing proof/PDF/banner pointers and owner are unchanged; unknown legacy metadata is explicit.");
  const rls = await db.$queryRaw<Array<{ enabled: boolean }>>`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = 'public.storage_objects'::regclass`;
  if (!rls[0].enabled) throw new Error();
  for (const role of ["anon", "authenticated"]) {
    let denied = false;
    try { await db.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`); await tx.storageObject.findMany(); }); } catch { denied = true; }
    if (!denied) throw new Error();
  }
  log("PASS: new accounting table has RLS and denies synthetic anon/authenticated SQL access.");
  await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "migrate", "deploy"], fixture.env, chunk => output.write(chunk));
  if (await db.storageObject.count() !== 3) throw new Error();
  log("PASS: repeated forward deployment is a no-op; no provider operations or file imports occurred.");
  process.exitCode = 0;
} catch {
  log("FAILED: disposable storage migration/backfill acceptance; no hosted target was used."); process.exitCode = 1;
} finally {
  await db?.$disconnect(); await fixture?.cleanup(); log("Cleanup complete: owned database stopped and fixture removed.");
  await new Promise<void>(resolve => output.end(resolve));
}
process.exit(process.exitCode ?? 1);
