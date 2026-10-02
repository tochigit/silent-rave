import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { freePort, startFixture } from "./fixture";

await mkdir("reports", { recursive: true });
const focus = process.argv.slice(2);
if (focus.some(p => !/^tests\/phase4\/[a-z-]+\.test\.ts$/.test(p))) throw new Error("Invalid focused test path");
const output = createWriteStream(`reports/phase4-${focus.length ? "focus-" : ""}${process.platform}-test-output.txt`, { flags: "w" });
function log(message: string) { console.log(message); output.write(`${message}\n`); }
let server: ChildProcess | undefined;
let testProcess: ChildProcess | undefined;
let serverLog: WriteStream | undefined;
let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
let stopping: Promise<void> | undefined;
const cleanup = () => stopping ??= (async () => {
  for (const child of [testProcess, server]) {
    if (!child?.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      const kill = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
      await kill.exited;
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    }
  }
  if (serverLog) {
    server?.stdout?.unpipe(serverLog); server?.stderr?.unpipe(serverLog);
    await new Promise<void>((resolve) => serverLog!.end(resolve));
  }
  await fixture?.cleanup();
})();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
}

try {
  log(focus.length ? `Phase 4 focused: ${focus.join(", ")}; isolated PostgreSQL/HTTP; fake transport/time.` : "Phase 4 + Phase 3b: all files; real HTTP/PostgreSQL/sharp/PDF; capture/fake transport; injected clock/backdated rows.");
  fixture = await startFixture((chunk) => { output.write(chunk); });
  const startApp = async (overrides: Record<string, string> = {}) => {
    const port = await freePort();
    const env = { ...fixture!.env, ...overrides, TEST_BASE_URL: `http://127.0.0.1:${port}` };
    server = spawn(process.execPath, ["--no-env-file", path.resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    serverLog ??= createWriteStream("reports/phase4-server.log", { flags: "w" });
    server.stdout?.pipe(serverLog, { end: false }); server.stderr?.pipe(serverLog, { end: false });
    let serverError: Error | undefined; server.once("error", error => { serverError = error; });
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (serverError) throw serverError;
      if (server.exitCode !== null) throw new Error("Fixture app exited before readiness.");
      try {
        const r = await fetch(env.TEST_BASE_URL, { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          // Compile login before the original 30s authz setup hook starts.
          // Empty body is rejected before login/session creation; no credentials.
          const warm = await fetch(env.TEST_BASE_URL + "/api/auth/login", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "127.0.0.254" }, body: "{}", signal: AbortSignal.timeout(120_000) });
          if (warm.status !== 400) throw new Error("Fixture login warmup failed.");
          log("Fixture app ready; login compiled; strict Origin checks; dedicated app port."); return env;
        }
      } catch { /* readiness only; tests never sleep for time */ }
      await Bun.sleep(250);
    }
    throw new Error("Fixture app readiness timed out.");
  };
  const runTests = async (paths: string[], env: Record<string, string>) => {
    const test = testProcess = spawn(process.execPath, ["--no-env-file", "test", "--timeout", "30000", ...paths], {
      env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [test.stdout, test.stderr]) stream?.on("data", (chunk: Buffer) => { process.stdout.write(chunk); output.write(chunk); });
    return new Promise<number>((resolve, reject) => { test.once("error", reject); test.once("close", code => resolve(code ?? 1)); });
  };
  const env = await startApp();
  let exitCode = await runTests(focus.length ? focus : ["tests/phase3b/", "tests/phase4/"], env);
  if (!focus.length && exitCode === 0) {
    log("Phase 4 kick-failure HTTP acceptance: kicks enabled; invalid worker sender; no real sends.");
    const old = server!;
    old.stdout?.unpipe(serverLog!); old.stderr?.unpipe(serverLog!);
    const closed = new Promise<void>(resolve => old.once("close", () => resolve()));
    if (process.platform === "win32") {
      await Bun.spawn(["taskkill", "/PID", String(old.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }).exited;
    } else { process.kill(-old.pid!, "SIGTERM"); }
    await closed;
    const failingEnv = await startApp({ EMAIL_FROM: "", EMAIL_KICK_ENABLED: "1", CRON_SECRET: "", RESEND_WEBHOOK_SECRET: "" });
    exitCode = await runTests(["tests/phase4-kick-failure.test.ts"], failingEnv);
  }
  log(`Phase 4 + Phase 3b runner exit: ${exitCode}`);
  process.exitCode = exitCode;
} catch (error) {
  log(`Phase 4 + Phase 3b runner failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  log("Cleanup complete: owned app and database stopped; temporary fixture removed.");
  await new Promise<void>((resolve) => output.end(resolve));
}
// Native process handles can keep Bun alive after all owned children stopped.
process.exit(process.exitCode ?? 0);
