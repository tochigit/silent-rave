import { sanitizedBuildEnvironment, assertEnvironmentFreeCheckout } from "./build-netlify-env";
import { readFile, writeFile, mkdir } from "node:fs/promises";
assertEnvironmentFreeCheckout();
const env = sanitizedBuildEnvironment(process.env);
if (!env.SR_NETLIFY_DEPLOY_ID || !env.SR_NETLIFY_SITE_NAME) throw new Error("Netlify build requires public deployment identity");
const identity = { id: env.SR_NETLIFY_DEPLOY_ID, site: env.SR_NETLIFY_SITE_NAME };
const file = "src/lib/hosting/build-identity.json";
const original = await readFile(file);
try {
  // A normal JSON import survives the pinned adapter's configuration rewriting.
  // Its two validated public identifiers are the only generated source values.
  await writeFile(file, JSON.stringify(identity) + "\n");
  const child = Bun.spawn([process.execPath, "run", "build"], { env, stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error("Netlify application build failed.");
  await mkdir("reports", { recursive: true });
  await writeFile("reports/netlify-public-build-identity.json", JSON.stringify(identity) + "\n");
} finally {
  await writeFile(file, original);
}
