import { runCommand, startFixture } from "./fixture";
import { spawn } from "node:child_process";

// The fixture stays alive only while this dev command runs; it never writes .env.
const fixture = await startFixture();
try {
  console.log(
    "Starting isolated fixture app on localhost:3000; Ctrl+C stops it.",
  );
  if (process.argv.includes("--browser-step3")) {
    const server = spawn(
      "node",
      ["node_modules/next/dist/bin/next", "dev", "--webpack", "--port", "3000"],
      {
        env: fixture.env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    try {
      const deadline = Date.now() + 600_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (server.exitCode !== null)
          throw new Error("Browser fixture app exited.");
        try {
          const r = await fetch("http://localhost:3000", {
            signal: AbortSignal.timeout(5000),
          });
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {}
        await Bun.sleep(250);
      }
      if (!ready) throw new Error("Browser fixture readiness timeout.");
      await runCommand(
        [
          process.execPath,
          "--no-env-file",
          "build",
          "scripts/browser-step3.ts",
          "--target=node",
          "--format=esm",
          "--packages=external",
          "--outfile=.test-runtime/browser-check/step3-run.mjs",
        ],
        fixture.env,
      );
      await runCommand(
        ["node", ".test-runtime/browser-check/step3-run.mjs"],
        fixture.env,
      );
    } finally {
      if (server.pid && server.exitCode === null) {
        if (process.platform === "win32")
          await Bun.spawn(
            ["taskkill", "/PID", String(server.pid), "/T", "/F"],
            { stdout: "ignore", stderr: "ignore" },
          ).exited;
        else process.kill(-server.pid, "SIGTERM");
      }
    }
  } else {
    await runCommand(
      [
        "node",
        "node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "--port",
        "3000",
      ],
      fixture.env,
    );
  }
} finally {
  await fixture.cleanup();
}
