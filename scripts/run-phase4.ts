import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { freePort, runCommand, startFixture } from "./fixture";

await mkdir("reports", { recursive: true });
const focus = process.argv.slice(2);
const step3 = process.env.SILENT_RAVE_TEST_STEP3 === "1";
const step4 = process.env.SILENT_RAVE_TEST_STEP4 === "1";
const suite = step4 ? "step4" : step3 ? "step3" : "phase4";
if (
  focus.some(
    (p) =>
      !new RegExp(
        `^tests/${step4 ? "(?:step4|step3|phase4)" : step3 ? "(?:step3|phase4)" : "phase4"}/[a-z-]+\\.test\\.ts$`,
      ).test(p),
  )
)
  throw new Error("Invalid focused test path");
const output = createWriteStream(
  `reports/${suite}-${focus.length ? "focus-" : ""}${process.platform}-test-output.txt`,
  { flags: "w" },
);
function log(message: string) {
  console.log(message);
  output.write(`${message}\n`);
}
let server: ChildProcess | undefined;
let testProcess: ChildProcess | undefined;
let serverLog: WriteStream | undefined;
let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
let stopping: Promise<void> | undefined;
const cleanup = () =>
  (stopping ??= (async () => {
    for (const child of [testProcess, server]) {
      if (!child?.pid || child.exitCode !== null) continue;
      if (process.platform === "win32") {
        const kill = Bun.spawn(
          ["taskkill", "/PID", String(child.pid), "/T", "/F"],
          { stdout: "ignore", stderr: "ignore" },
        );
        await kill.exited;
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* already exited */
        }
      }
    }
    if (serverLog) {
      server?.stdout?.unpipe(serverLog);
      server?.stderr?.unpipe(serverLog);
      await new Promise<void>((resolve) => serverLog!.end(resolve));
    }
    await fixture?.cleanup();
  })());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

try {
  log(
    focus.length
      ? `${suite} focused: ${focus.join(", ")}; isolated PostgreSQL/HTTP; fake transport/time.`
      : `${suite}: baseline + Phase 4${step3 ? " + Step 3" : ""}; real HTTP/PostgreSQL/sharp/PDF; capture/fake transport; injected clock/backdated rows.`,
  );
  fixture = await startFixture((chunk) => {
    output.write(chunk);
  });
  const startApp = async (
    overrides: Record<string, string> = {},
    mode: "baseline" | "phase4" | "customer" | "operations" = "phase4",
  ) => {
    const port = await freePort();
    const env: Record<string, string> = {
      ...fixture!.env,
      ...overrides,
      TEST_BASE_URL: `http://127.0.0.1:${port}`,
    };
    // Next's CSS workers run Node. Bun's --no-env-file is propagated by Next
    // into NODE_OPTIONS, where Node rejects it. Keep the fixture runner under
    // Bun with dotenv disabled; launch Next under Node with explicit fixture env.
    server = spawn(
      "node",
      [
        path.resolve("node_modules/next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    serverLog ??= createWriteStream(`reports/${suite}-server.log`, {
      flags: "w",
    });
    server.stdout?.pipe(serverLog, { end: false });
    server.stderr?.pipe(serverLog, { end: false });
    let serverError: Error | undefined;
    server.once("error", (error) => {
      serverError = error;
    });
    // Cold Windows module/CSS loading can exceed five minutes; readiness only,
    // never retries assertions or changes the webhook's replay window.
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      if (serverError) throw serverError;
      if (server.exitCode !== null)
        throw new Error("Fixture app exited before readiness.");
      let probe: Response | undefined;
      try {
        probe = await fetch(env.TEST_BASE_URL, {
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        /* Root readiness probe only; failed warmup contracts below fail immediately. */
      }
      if (probe?.ok) {
        // Compile login before the original 30s authz setup hook starts.
        // Empty body is rejected before login/session creation; no credentials.
        const warm = await fetch(env.TEST_BASE_URL + "/api/auth/login", {
          method: "POST",
          headers: {
            host: "localhost:3000",
            origin: "http://localhost:3000",
            "content-type": "application/json",
            "x-forwarded-for": "127.0.0.254",
          },
          body: "{}",
          signal: AbortSignal.timeout(120_000),
        });
        if (warm.status !== 400)
          throw new Error("Fixture login warmup failed.");
        // Compile the worker's PDF/email modules before the unchanged 30s
        // acceptance test. Missing credentials fail before any job is claimed.
        if (mode !== "baseline") {
          const workerWarm = await fetch(
            env.TEST_BASE_URL + "/api/internal/process-email-jobs",
            { method: "POST", signal: AbortSignal.timeout(120_000) },
          );
          if (workerWarm.status !== 401)
            throw new Error("Fixture worker warmup failed closed check.");
          const checkWarm = async (
            target: string,
            expected: number,
            init: RequestInit = {},
          ) => {
            const response = await fetch(env.TEST_BASE_URL + target, {
              ...init,
              signal: AbortSignal.timeout(120_000),
            });
            if (response.status !== expected)
              throw new Error(`Fixture route warmup failed: ${target}`);
            await response.arrayBuffer();
          };
          if (
            !focus.length ||
            focus.some((p) => /\/(?:pdf|routes|status)\.test\.ts$/.test(p))
          ) {
            // Unauthorized PDF warmup compiles its engine without reading any ticket.
            await checkWarm(
              "/api/orders/SR-WARMUP/tickets/00000000-0000-0000-0000-000000000000/pdf",
              404,
            );
            if (mode === "phase4") {
              // Login only to the newly owned fixture account. Invalid inputs below
              // compile controllers before test clocks; no order transitions/mail.
              const login = await fetch(env.TEST_BASE_URL + "/api/auth/login", {
                method: "POST",
                headers: {
                  host: "localhost:3000",
                  origin: "http://localhost:3000",
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  email: env.OWNER_EMAIL,
                  password: env.OWNER_PASSWORD,
                  intent: "admin",
                }),
                signal: AbortSignal.timeout(120_000),
              });
              const cookie = login.headers.get("set-cookie")?.split(";")[0];
              if (login.status !== 200 || !cookie)
                throw new Error("Fixture OWNER warmup login failed.");
              const headers = {
                host: "admin.localhost:3000",
                origin: "http://admin.localhost:3000",
                cookie,
                "content-type": "application/json",
              };
              const id = "00000000-0000-0000-0000-000000000000";
              await checkWarm(`/api/admin/orders/${id}/refund`, 400, {
                method: "POST",
                headers,
                body: "{}",
              });
              await checkWarm(`/api/admin/orders/${id}/resend-tickets`, 400, {
                method: "POST",
                headers,
                body: '{"warmup":true}',
              });
              await checkWarm("/api/admin/email-jobs", 200, { headers });
              await checkWarm(`/api/admin/orders/${id}`, 404, { headers });
            } else {
              await checkWarm("/api/orders/SR-WARMUP/status", 404);
              await checkWarm("/order/SR-WARMUP", 200);
            }
          }
        }
        log(
          "Fixture app ready; login compiled; strict Origin checks; dedicated app port.",
        );
        if (step4 && (mode === "operations" || focus.some(p => p.includes("/step4/")))) {
          const login = await fetch(env.TEST_BASE_URL + "/api/auth/login", { method: "POST", headers: { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }), signal: AbortSignal.timeout(120000) });
          const cookie = login.headers.get("set-cookie")?.split(";")[0];
          if (login.status !== 200 || !cookie) throw new Error("Step 4 warmup login failed.");
          for (const target of ["/api/admin/events", "/api/staff/session"]) {
            const response = await fetch(env.TEST_BASE_URL + target, { headers: { cookie }, signal: AbortSignal.timeout(120000) });
            if (response.status !== 200) throw new Error(`Step 4 warmup failed: ${target}`); await response.arrayBuffer();
          }
          for (const target of ["/api/admin/orders/issue", "/api/auth/password"]) {
            const response = await fetch(env.TEST_BASE_URL + target, { method: "POST", headers: { cookie, host: "admin.localhost:3000", origin: "http://admin.localhost:3000", "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(120000) });
            if (response.status !== 400) throw new Error(`Step 4 controller warmup failed: ${target}`); await response.arrayBuffer();
          }
        }
        return env;
      }
      await Bun.sleep(250);
    }
    throw new Error("Fixture app readiness timed out.");
  };
  const runTests = async (paths: string[], env: Record<string, string>) => {
    const test = (testProcess = spawn(
      process.execPath,
      ["--no-env-file", "test", "--timeout", "30000", ...paths],
      {
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ));
    for (const stream of [test.stdout, test.stderr])
      stream?.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
        output.write(chunk);
      });
    return new Promise<number>((resolve, reject) => {
      test.once("error", reject);
      test.once("close", (code) => resolve(code ?? 1));
    });
  };
  const stopApp = async () => {
    const old = server!;
    if (old.exitCode !== null) return;
    old.stdout?.unpipe(serverLog!);
    old.stderr?.unpipe(serverLog!);
    const closed = new Promise<void>((resolve) =>
      old.once("close", () => resolve()),
    );
    if (process.platform === "win32") {
      await Bun.spawn(["taskkill", "/PID", String(old.pid), "/T", "/F"], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
    } else {
      process.kill(-old.pid!, "SIGTERM");
    }
    await closed;
  };
  let exitCode = 0;
  const groups = focus.length
    ? [{ paths: focus, mode: "phase4" as const }]
    : [
        { paths: ["tests/phase3b/"], mode: "baseline" as const },
        { paths: ["tests/phase4/"], mode: "phase4" as const },
        ...(step3
          ? [{ paths: ["tests/step3/"], mode: "customer" as const }]
          : []),
        ...(step4 ? [{ paths: ["tests/step4/"], mode: "operations" as const }] : []),
      ];
  for (const group of groups) {
    if (group.mode === "customer" || group.mode === "operations") {
      // Legacy tests deliberately alter order/counter rows. Their short holds
      // can lapse during a slow local run; the customer's real global expiry
      // sweep must start from a consistent fresh database, not those leftovers.
      await fixture.cleanup();
      fixture = undefined;
      fixture = await startFixture((chunk) => output.write(chunk));
      log(
        "Customer group: fresh owned database; prior fixture cleanup passed.",
      );
    }
    log(
      `Test group: ${group.mode}; isolated database; fresh app/test processes.`,
    );
    if (
      group.mode === "phase4" &&
      (!focus.length || focus.some((p) => p.includes("/pdf.test.ts")))
    ) {
      await runCommand(
        [
          "python",
          "-c",
          "import pymupdf, zxingcpp; print('PDF verifier native imports ready.')",
        ],
        fixture.env,
        (chunk) => output.write(chunk),
      );
    }
    const env = await startApp({}, group.mode);
    exitCode = await runTests(group.paths, env);
    await stopApp();
    if (exitCode !== 0) break;
  }
  if (!focus.length && exitCode === 0) {
    log(
      "Phase 4 kick-failure HTTP acceptance: kicks enabled; invalid worker sender; no real sends.",
    );
    const failingEnv = await startApp({
      EMAIL_FROM: "",
      EMAIL_KICK_ENABLED: "1",
      CRON_SECRET: "",
      RESEND_WEBHOOK_SECRET: "",
    });
    exitCode = await runTests(
      ["tests/phase4-kick-failure.test.ts"],
      failingEnv,
    );
  }
  log(`Phase 4 + Phase 3b runner exit: ${exitCode}`);
  process.exitCode = exitCode;
} catch (error) {
  log(
    `Phase 4 + Phase 3b runner failed: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
} finally {
  await cleanup();
  log(
    "Cleanup complete: owned app and database stopped; temporary fixture removed.",
  );
  await new Promise<void>((resolve) => output.end(resolve));
}
// Native process handles can keep Bun alive after all owned children stopped.
process.exit(process.exitCode ?? 0);
