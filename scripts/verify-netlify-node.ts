import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { startFixture, runCommand } from "./fixture";
const fixture = await startFixture();
const original = { ...process.env };
const functionRoot = await mkdtemp(path.join(tmpdir(), "silent-rave-step5c1-"));
try {
  Object.assign(process.env, fixture.env, { TEST_BASE_URL: "http://127.0.0.1:1" });
  const { db } = await import("../src/lib/db");
  const { approvedOrder, orderFixture } = await import("../tests/phase4/fixtures");
  const { createSession } = await import("../src/lib/auth/session");
  const { deriveStatusToken } = await import("../src/lib/orders/status-token");
  const approved = await approvedOrder(1);
  const pending = await orderFixture(1, false);
  await db.paymentProof.deleteMany({ where: { orderId: pending.order.id } });
  await db.order.update({ where: { id: pending.order.id }, data: { status: "PENDING", proofAttempts: 0, holdExpiresAt: new Date(Date.now() + 24 * 3600000) } });
  const staff = await db.staffUser.create({ data: { name: "Native fixture staff", email: `native-${crypto.randomUUID()}@example.test`, role: "STAFF", passwordHash: "unused-fixture-password-hash" } });
  const ownerSession = await createSession(approved.owner.id), staffSession = await createSession(staff.id);
  // Execute the final ZIP outside the repository so missing traced dependencies
  // cannot silently resolve from the development node_modules tree.
  const archive = path.resolve(".netlify/functions/___netlify-server-handler.zip");
  await runCommand(["python", "scripts/extract-netlify-function.py", archive, functionRoot], fixture.env);
  const fonts: Record<string, string> = {};
  for (const name of ["NotoSans-Regular.ttf", "OFL.txt"]) {
    const source = await readFile(`assets/fonts/${name}`), packed = await readFile(path.join(functionRoot, "assets/fonts", name));
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    if (hash(source) !== hash(packed)) throw new Error("Packaged font/license mismatch"); fonts[name] = hash(packed);
  }
  const input = path.join(fixture.runDir, "node-input.json");
  const output = path.resolve(`reports/step5c1-${process.platform}-node-acceptance.json`);
  const pdf = path.resolve(".test-runtime/step5c1-packaged-ticket.pdf");
  await writeFile(input, JSON.stringify({ functionRoot, output, pdf, fonts, functionZipFingerprint: createHash("sha256").update(await readFile(archive)).digest("hex"), ownerToken: ownerSession.token, staffToken: staffSession.token, staffId: staff.id,
    pdfPath: `/api/orders/${approved.order.orderCode}/tickets/${approved.tickets[0].id}/pdf`, pdfToken: deriveStatusToken(approved.order.id, approved.order.statusTokenVersion), qrToken: approved.tickets[0].qrToken,
    proofPath: `/api/orders/${pending.order.orderCode}/proof`, proofToken: deriveStatusToken(pending.order.id, pending.order.statusTokenVersion), proofOrderId: pending.order.id }), { mode: 0o600 });
  await db.$disconnect();
  const env = { ...fixture.env, NODE_ENV: "production", HOST_PLATFORM: "netlify", ROOT_DOMAIN: "silent-rave.example.test", PUBLIC_BASE_URL: "https://silent-rave.example.test",
    DEPLOY_ID: "fixture", AUTH_INTERNAL_BASE_URL: "https://fixture--silent-rave-fixture.netlify.app", NETLIFY_INGRESS_SECRET: randomBytes(32).toString("base64url"), NODE_PATH: "" };
  await runCommand(["node", path.resolve("scripts/netlify-node-acceptance.mjs"), input], env);
  const check = Bun.spawn(["python", "scripts/verify-ticket-pdf.py", pdf], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(check.stdout).text(); await new Response(check.stderr).text();
  if (await check.exited) throw new Error("Packaged PDF visual/QR verification failed");
  const inspection = JSON.parse(text.trim().split("\n").at(-1)!);
  if (!inspection.embedded || inspection.decoded.length !== 1 || inspection.decoded[0] !== approved.tickets[0].qrToken ||
    !inspection.text.replaceAll("\n", "").includes("Chloé Ọlá") || !inspection.text.includes("04 October 2030 at 00:30")) throw new Error("Packaged PDF font/text/QR contract failed");
  const result = JSON.parse(await readFile(output, "utf8"));
  await mkdir("reports", { recursive: true });
  await writeFile(output, JSON.stringify({ ...result, embeddedFontDiacritics: true, exactStoredQrDecode: true, lagosDateText: true }, null, 2) + "\n");
  console.log("Packaged Node 24 Prisma, Sharp upload/EXIF, font/license, live auth and PDF/QR acceptance passed.");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original);
  await fixture.cleanup();
  if (path.dirname(path.resolve(functionRoot)) !== path.resolve(tmpdir()) || !path.basename(functionRoot).startsWith("silent-rave-step5c1-")) throw new Error("Unsafe package cleanup directory");
  await rm(functionRoot, { recursive: true, force: true });
}
process.exit(0);
