import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const repository = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const INGRESS = "silent-rave-request-context";
const originalCjsHash = "a6bf39c7ed3e4da549b446e03cf65b46299adaa85c880daa7a1f1c6eaea2372a";
export async function correctCjsPaths(file) {
  const original = await readFile(file, "utf8");
  const marker = "{ windows: false }";
  const patched = original.replaceAll(marker, "{ windows: Deno.build.os === 'windows' }");
  const hash = text => createHash("sha256").update(text).digest("hex");
  if (hash(original) === originalCjsHash && original.split(marker).length === 3) {
    await writeFile(file, patched);
    return hash(patched);
  }
  // Only the exact inspected correction is accepted on an idempotent rerun.
  const restored = original.replaceAll("{ windows: Deno.build.os === 'windows' }", marker);
  if (hash(restored) !== originalCjsHash) throw new Error("Unknown adapter CJS runtime");
  return hash(original);
}
export async function correctVirtualCwd(file) {
  const source = await readFile(file, "utf8");
  const original = "Deno.cwd = () => ''";
  const corrected = "Deno.cwd = () => Deno.build.os === 'windows' ? 'C:\\\\' : ''";
  const restored = source.replace(corrected, original);
  if (createHash("sha256").update(restored).digest("hex") !== "5e5b4c254c19c154c70c27c38e07e1d49c71b96d524b2ad174696d04b8a31a12") throw new Error("Unknown adapter cwd shim");
  const result = source.replace(original, corrected);
  await writeFile(file, result);
  return result;
}
export async function integrateIngress(base) {
  const dir = resolve(base, ".netlify/edge-functions");
  const file = join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.functions) || manifest.functions.length === 0 ||
    manifest.functions.filter(f => f.function !== INGRESS).some(f => f.function !== "___netlify-edge-handler-node-middleware" || f.generator !== "@netlify/plugin-nextjs@5.16.2")) throw new Error("Unsupported Next Edge manifest");
  const declarations = manifest.functions.filter(f => f.function !== INGRESS);
  if (!declarations.length || !declarations.every(f => typeof f.pattern === "string" && !f.cache) ||
    new Set(declarations.map(f => f.pattern)).size !== declarations.length) throw new Error("Unsupported middleware declaration");
  const cjsFingerprint = await correctCjsPaths(join(dir, declarations[0].function, "edge-runtime/lib/cjs.ts"));
  // The inlined shim's empty cwd breaks Windows path.relative/resolve. Keep
  // Linux output unchanged; a fixed virtual drive root restores path semantics.
  const generated = join(dir, declarations[0].function, "server/node-middleware.js");
  const handler = await readFile(generated, "utf8");
  const cwdOriginal = "Deno.cwd = () => ''";
  const shim = await correctVirtualCwd(join(dir, declarations[0].function, "edge-runtime/shim/node.js"));
  const cwdCorrected = "Deno.cwd = () => Deno.build.os === 'windows' ? 'C:\\\\' : ''";
  if (!handler.includes(cwdOriginal) && !handler.includes(cwdCorrected)) throw new Error("Unknown generated cwd shim");
  await writeFile(generated, handler.replace(cwdOriginal, cwdCorrected));
  const target = join(dir, INGRESS);
  await mkdir(target, { recursive: true });
  const source = await readFile(join(repository, "netlify/ingress/request-context.ts"), "utf8");
  const originalImport = '"../../src/lib/hosting/context-protocol.ts"';
  if (!source.includes(originalImport)) throw new Error("Unknown ingress import contract");
  await writeFile(join(target, "index.ts"), source.replace(originalImport, '"./context-protocol.ts"'));
  await copyFile(join(repository, "src/lib/hosting/context-protocol.ts"), join(target, "context-protocol.ts"));
  manifest.functions = [{ function: INGRESS, path: "/*", generator: "silent-rave-ingress@1", name: "Trusted request context" }, ...declarations];
  await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  return { adapter: "5.16.2", cjsFingerprint, fingerprint: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}
export async function onBuild({ constants, utils }) {
  try {
    const result = await integrateIngress(constants.PACKAGE_PATH || process.cwd());
    console.log(`[ingress] adapter=${result.adapter} manifest=${result.fingerprint}`);
  } catch {
    utils.build.failBuild("Cannot prove trusted ingress precedes the Next proxy.");
  }
}
export async function assertBundledIngress(base, outputDirectory = resolve(base, ".netlify/edge-functions-dist")) {
  const manifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8"));
  if (manifest.bundler_version !== "16.1.2" || !Array.isArray(manifest.routes) || !manifest.bundles?.length ||
    manifest.routes.filter(route => route.function === INGRESS).length !== 1) throw new Error("Unknown final Edge bundle");
  for (const path of ["/", "/admin", "/staff", "/api/admin/future.feature", "/api/staff/future.feature", "/%61dmin/future", "/api/internal/session-decision", "/.netlify/functions/handler"]) {
    const match = manifest.routes.filter(route => new RegExp(route.pattern).test(path)).map(route => route.function);
    if (match[0] !== INGRESS || match[1] !== "___netlify-edge-handler-node-middleware") throw new Error("Unknown final Edge ordering");
  }
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
export async function onPostBuild({ constants, utils }) {
  try {
    const base = constants.PACKAGE_PATH || process.cwd();
    const fingerprint = await assertBundledIngress(base, resolve(base, constants.EDGE_FUNCTIONS_DIST));
    await mkdir(join(base, "reports"), { recursive: true });
    await writeFile(join(base, `reports/step5c1-${process.platform}-ordering-acceptance.json`), JSON.stringify({ adapter: "5.16.2", bundler: "16.1.2", fingerprint, ingressFirst: true }, null, 2) + "\n");
    console.log(`[ingress] final-bundle=${fingerprint}`);
  } catch { utils.build.failBuild("Cannot prove trusted ingress order in the final Edge bundle."); }
}
