import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";
import { strict as assert } from "node:assert";
const input = JSON.parse(await readFile(process.argv[2], "utf8"));
assert(process.versions.node.startsWith("24."), "Packaged runtime requires Node 24");
assert(process.env.SILENT_RAVE_ISOLATED_FIXTURE === "1" && new URL(process.env.DATABASE_URL).hostname === "127.0.0.1", "Owned loopback fixture required");
process.chdir(input.functionRoot);
// This harness has no provider credentials and must never contact a provider.
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const target = new URL(url instanceof Request ? url.url : String(url));
  if (target.hostname !== "127.0.0.1") throw new Error("External fetch forbidden in isolated package acceptance");
  return originalFetch(url, init);
};
const requirePacked = createRequire(path.join(input.functionRoot, "___netlify-server-handler.mjs"));
for (const name of ["@prisma/client", "sharp"]) assert(requirePacked.resolve(name).startsWith(input.functionRoot + path.sep), "Dependency must come from the final function ZIP");
const { PrismaClient } = requirePacked("@prisma/client");
const sharp = requirePacked("sharp");
const db = new PrismaClient();
const backgrounds = [];
const context = { account: { id: "fixture" }, deploy: { id: "fixture" }, site: { id: "fixture", name: "silent-rave-fixture", url: "https://fixture--silent-rave-fixture.netlify.app" },
  ip: "203.0.113.7", geo: {}, requestId: "fixture-request", server: { region: "fixture" }, waitUntil: promise => backgrounds.push(promise) };
const root = "https://silent-rave.example.test";
function signed(url, method) {
  const parsed = new URL(url);
  const raw = JSON.stringify({ v: 1, hostname: parsed.hostname, origin: parsed.origin, clientIp: context.ip, method, originalPathname: parsed.pathname, deploymentId: "fixture", issuedAt: Date.now() });
  return { "x-sr-context": raw, "x-sr-signature": createHmac("sha256", process.env.NETLIFY_INGRESS_SECRET).update(raw).digest("hex") };
}
function privateResponse(response) {
  for (const [name, value] of Object.entries({ "cache-control": "private, no-store", "cdn-cache-control": "no-store", "netlify-cdn-cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" })) assert.equal(response.headers.get(name), value, `Native private ${name}`);
}
try {
  assert.equal((await db.$queryRaw`SELECT 1::int AS value`)[0].value, 1);
  assert.equal(requirePacked("@prisma/client/package.json").version, "6.19.2"); assert.equal(sharp.versions.sharp, "0.34.5");
  const { default: handler } = await import(pathToFileURL(path.join(input.functionRoot, "___netlify-server-handler.mjs")).href);
  async function call(route, init = {}, verified = true, origin = root) {
    const url = origin + route, method = init.method ?? "GET";
    const headers = new Headers({ "x-nf-next-middleware": "skip", ...(verified ? signed(url, method) : {}), ...init.headers });
    return handler(new Request(url, { ...init, method, headers }), context);
  }
  // Warm the compiled Next handler without any session/metadata; no TTL expansion.
  const warm = await call("/api/staff/session", {}, false); assert.equal(warm.status, 421); await warm.arrayBuffer(); privateResponse(warm);
  const owner = { cookie: `sr_session=${input.ownerToken}` }, staff = { cookie: `sr_session=${input.staffToken}` };
  const ownerRead = await call("/api/admin/events", { headers: owner }); assert.equal(ownerRead.status, 200); await ownerRead.arrayBuffer(); privateResponse(ownerRead);
  const denied = await call("/api/admin/events", { headers: staff }); assert.equal(denied.status, 403); await denied.arrayBuffer(); privateResponse(denied);
  const untrusted = await call("/api/admin/events", { headers: owner }, false); assert.equal(untrusted.status, 421); await untrusted.arrayBuffer(); privateResponse(untrusted);
  const staffRead = await call("/api/staff/session", { headers: staff }); assert.equal(staffRead.status, 200); await staffRead.arrayBuffer(); privateResponse(staffRead);
  await db.staffUser.update({ where: { id: input.staffId }, data: { mustChangePassword: true } });
  const temporary = await call("/api/staff/session", { headers: staff }); assert.equal(temporary.status, 403); await temporary.arrayBuffer(); privateResponse(temporary);
  await db.staffUser.update({ where: { id: input.staffId }, data: { mustChangePassword: false, isActive: false } });
  const inactive = await call("/api/staff/session", { headers: staff }); assert.equal(inactive.status, 401); await inactive.arrayBuffer(); privateResponse(inactive);
  const brokerBody = { v: 1, token: input.ownerToken, surface: "admin", method: "GET", originalPathname: "/admin/future", effectivePathname: "/admin/future", publicOrigin: root };
  const broker = await call("/api/internal/session-decision", { method: "POST", headers: { "content-type": "application/json", "x-proxy-auth": process.env.PROXY_AUTH_SECRET }, body: JSON.stringify(brokerBody) }, true, process.env.AUTH_INTERNAL_BASE_URL);
  assert.equal(broker.status, 200); privateResponse(broker);
  const decision = await broker.json(); assert.equal(decision.decision, "ALLOW"); assert.equal(decision.deploymentId, "fixture"); assert(!("user" in decision) && !("token" in decision));
  const pdf = await call(input.pdfPath, { headers: { "x-status-token": input.pdfToken } }); assert.equal(pdf.status, 200, "Packaged PDF endpoint"); assert.equal(pdf.headers.get("content-type"), "application/pdf");
  await writeFile(input.pdf, Buffer.from(await pdf.arrayBuffer()));
  const original = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#aabbcc" } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: "SYNTHETIC-NATIVE-EXIF" } } }).toBuffer();
  assert((await sharp(original).metadata()).exif);
  const form = new FormData(); form.append("proof", new Blob([original], { type: "image/jpeg" }), "synthetic-proof.jpg");
  form.append("transfer_reference", "NATIVE-PACKAGE-REFERENCE"); form.append("sender_name", "Synthetic Sender"); form.append("client_submission_id", crypto.randomUUID());
  const proof = await call(input.proofPath, { method: "POST", headers: { "x-status-token": input.proofToken }, body: form }); assert.equal(proof.status, 200, "Packaged Sharp upload endpoint"); await proof.arrayBuffer();
  const row = await db.paymentProof.findFirstOrThrow({ where: { orderId: input.proofOrderId } });
  const sanitized = await readFile(path.join(process.env.LOCAL_STORAGE_DIR, row.storagePath)); assert(!(await sharp(sanitized).metadata()).exif, "EXIF stripped in actual packaged upload");
  await Promise.all(backgrounds);
  await writeFile(input.output, JSON.stringify({ node: process.version, platform: process.platform, finalZipIsolation: true, functionZipFingerprint: input.functionZipFingerprint, packagedPrismaQuery: true, packagedSharpUpload: true, exifRemoved: true,
    independentLiveGuards: true, secretGatedBroker: true, packagedPdf: true, fonts: input.fonts }, null, 2) + "\n");
  console.log("Packaged Node handler and native dependency checks passed.");
  await db.$disconnect(); process.exit(0);
} catch (error) {
  console.error(`Packaged Node acceptance failed: ${error.message}`);
  await db.$disconnect(); process.exit(1);
}
