import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { readTrustedContextNode } from "../src/lib/hosting/request-context-node";
import { sanitizedBuildEnvironment } from "./build-netlify-env";
import { buildCanaries } from "./build-canaries";
import { assertBundledIngress } from "../netlify/plugins/ingress/integration.mjs";
const root = process.cwd();
const nextBuild = JSON.parse(await readFile(".next/required-server-files.json", "utf8"));
assert.deepEqual({ id: nextBuild.config.env.SR_NETLIFY_DEPLOY_ID, site: nextBuild.config.env.SR_NETLIFY_SITE_NAME },
  { id: "fixture", site: "silent-rave-fixture" }, "Compiled public identity must match the owned acceptance deployment");
const fingerprint = await assertBundledIngress(root);
const trace = JSON.parse(await readFile(".next/server/middleware.js.nft.json", "utf8"));
assert(trace.files.length > 0);
assert(!trace.files.some((file: string) => /(?:prisma|sharp|fontkit|assets[\\/]fonts|bcrypt|\.node$)/i.test(file)), "Native/server-only dependency in proxy trace");
const canaries = Object.values(buildCanaries).map(value => Buffer.from(value));
let inspectedFiles = 0;
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await inspect(file);
    else {
      const bytes = await readFile(file); inspectedFiles++;
      assert(!canaries.some(canary => bytes.includes(canary)), `Synthetic build secret found in ${path.relative(root, file)}`);
      assert(!/^\.env(?:\.|$)/.test(entry.name), "Dotenv file in output");
    }
  }
}
await inspect(".netlify"); await inspect(".next/static");
await mkdir(".test-runtime", { recursive: true });
const modulePath = path.resolve(".test-runtime/netlify-tools/node_modules/@netlify/edge-bundler/dist/node/bridge.js");
const { DenoBridge } = await import(pathToFileURL(modulePath).href);
const bridge = new DenoBridge({ useGlobal: true });
const transferFile = path.resolve(".test-runtime/step5c1-edge-node-transfers.json");
const env = { ...sanitizedBuildEnvironment(process.env), NODE_ENV: "production", HOST_PLATFORM: "netlify", ROOT_DOMAIN: "silent-rave.example.test",
  PUBLIC_BASE_URL: "https://silent-rave.example.test", SR_NETLIFY_DEPLOY_ID: "fixture", SR_NETLIFY_SITE_NAME: "silent-rave-fixture",
  PROXY_AUTH_SECRET: "synthetic-runtime-broker-0000000000000000", NETLIFY_INGRESS_SECRET: "synthetic-runtime-ingress-0000000000000000" };
const result = await bridge.run(["run", "-A", "--no-check", "--unstable-sloppy-imports", path.resolve("scripts/netlify-edge-acceptance.mjs"), pathToFileURL(root + path.sep).href, transferFile], { env, extendEnv: false });
const edge = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
const transfers = JSON.parse(await readFile(transferFile, "utf8")) as { url: string; method: string; headers: [string, string][] }[];
assert(transfers.length >= 2);
for (const value of transfers) {
  const context = readTrustedContextNode(new Request(value.url, { method: value.method, headers: value.headers }), env);
  assert.equal(context.clientIp, "203.0.113.7"); assert.equal(context.deploymentId, "fixture");
}
await writeFile(`reports/step5c1-${process.platform}-edge-acceptance.json`, JSON.stringify({ fingerprint, proxyTraceFingerprint: createHash("sha256").update(JSON.stringify(trace)).digest("hex"),
  proxyNativeFree: true, buildCanariesAbsent: true, inspectedFiles, ...edge, nodeContextVerification: true }, null, 2) + "\n");
console.log("Final Edge ordering, generated Deno execution, Node context verification, native-free proxy and build-secret checks passed.");
