import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const repository = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const INGRESS = "silent-rave-request-context";
export async function integrateIngress(base) {
  const dir = resolve(base, ".netlify/edge-functions");
  const file = join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.functions) || manifest.functions.length === 0 ||
    manifest.functions.filter(f => f.function !== INGRESS).some(f => f.function !== "___netlify-edge-handler-node-middleware" || f.generator !== "@netlify/plugin-nextjs@5.16.2")) throw new Error("Unsupported Next Edge manifest");
  const declarations = manifest.functions.filter(f => f.function !== INGRESS);
  if (!declarations.every(f => typeof f.pattern === "string" && !f.cache)) throw new Error("Unsupported middleware declaration");
  const target = join(dir, INGRESS);
  await mkdir(target, { recursive: true });
  const source = await readFile(join(repository, "netlify/ingress/request-context.ts"), "utf8");
  const originalImport = '"../../src/lib/hosting/context-protocol.ts"';
  if (!source.includes(originalImport)) throw new Error("Unknown ingress import contract");
  await writeFile(join(target, "index.ts"), source.replace(originalImport, '"./context-protocol.ts"'));
  await copyFile(join(repository, "src/lib/hosting/context-protocol.ts"), join(target, "context-protocol.ts"));
  manifest.functions = [{ function: INGRESS, path: "/*", generator: "silent-rave-ingress@1", name: "Trusted request context" }, ...declarations];
  await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
  return { adapter: "5.16.2", fingerprint: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}
export async function onBuild({ constants, utils }) {
  try {
    const result = await integrateIngress(constants.PACKAGE_PATH || process.cwd());
    console.log(`[ingress] adapter=${result.adapter} manifest=${result.fingerprint}`);
  } catch {
    utils.build.failBuild("Cannot prove trusted ingress precedes the Next proxy.");
  }
}
