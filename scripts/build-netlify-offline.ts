import { sanitizedBuildEnvironment, assertEnvironmentFreeCheckout } from "./build-netlify-env";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildCanaries } from "./build-canaries";
assertEnvironmentFreeCheckout();
await mkdir("reports", { recursive: true });
const log = createWriteStream(`reports/step5c1-netlify-${process.platform}-build.txt`, { flags: "w" });
const cli = path.resolve(".test-runtime/netlify-tools/node_modules/netlify-cli/bin/run.js");
// Offline is a local build/bundle operation. No login, link, deployment or API token.
const child = spawn("node", [cli, "build", "--offline"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...sanitizedBuildEnvironment({ ...process.env, DEPLOY_ID: "fixture", SITE_NAME: "silent-rave-fixture" }),
    ...buildCanaries, CI: "true", NO_UPDATE_NOTIFIER: "1" } });
for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk: Buffer) => { process.stdout.write(chunk); log.write(chunk); });
const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code ?? 1)); });
await new Promise<void>(resolve => log.end(resolve));
if (code) throw new Error("Offline Netlify build failed; see the local build report.");
