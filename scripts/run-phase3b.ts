import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { freePort, startFixture } from "./fixture";

await mkdir("reports", { recursive: true });
const output = createWriteStream(`reports/phase3b-${process.platform}-test-output.txt`, { flags: "w" });
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
  log("Phase 3b: all test files; real HTTP, PostgreSQL, and sharp; no email provider.");
  fixture = await startFixture((chunk) => { output.write(chunk); });
  const port = await freePort();
  const env = { ...fixture.env, TEST_BASE_URL: `http://127.0.0.1:${port}` };
  const next = path.resolve("node_modules/next/dist/bin/next");
  server = spawn(process.execPath, ["--no-env-file", next, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  serverLog = createWriteStream("reports/phase3b-server.log", { flags: "w" });
  server.stdout?.pipe(serverLog, { end: false });
  server.stderr?.pipe(serverLog, { end: false });
  let serverError: Error | undefined;
  server.once("error", (error) => { serverError = error; });
  const deadline = Date.now() + 300_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error("Fixture app exited before readiness.");
    try {
      const response = await fetch(env.TEST_BASE_URL, { signal: AbortSignal.timeout(3000) });
      if (response.ok) { ready = true; break; }
    } catch { /* startup probe only; test time is controlled with backdated rows */ }
    await Bun.sleep(250);
  }
  if (!ready) throw new Error("Fixture app readiness timed out.");
  log("Fixture app ready; strict Origin checks; dedicated app port.");
  const test = testProcess = spawn(process.execPath, ["--no-env-file", "test", "--timeout", "30000", "tests/phase3b/"], {
    env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [test.stdout, test.stderr]) stream?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk); output.write(chunk);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    test.once("error", reject); test.once("close", (code) => resolve(code ?? 1));
  });
  log(`Phase 3b runner exit: ${exitCode}`);
  process.exitCode = exitCode;
} catch (error) {
  log(`Phase 3b runner failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  log("Cleanup complete: owned app and database stopped; temporary fixture removed.");
  await new Promise<void>((resolve) => output.end(resolve));
}
// Native process handles can keep Bun alive after all owned children stopped.
process.exit(process.exitCode ?? 0);
