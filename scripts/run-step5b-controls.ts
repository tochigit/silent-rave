import { mkdir, writeFile } from "node:fs/promises";
import { startFixture, runCommand } from "./fixture";
await mkdir("reports", { recursive: true });
const chunks: Uint8Array[] = [];
let fixture: Awaited<ReturnType<typeof startFixture>> | undefined;
try {
  fixture = await startFixture((chunk) => chunks.push(chunk), false, true);
  await runCommand(
    [
      process.execPath,
      "--no-env-file",
      "test",
      "--timeout",
      "60000",
      "tests/step5b/rate-limits.test.ts",
      "tests/step5b/privacy.test.ts",
      "tests/step5b/mail-quota.test.ts",
      "tests/step5b/scheduler.test.ts",
      "tests/step5b/measurements.test.ts",
    ],
    {
      ...fixture.env,
      DATABASE_URL: fixture.appDatabaseUrl!,
      TEST_BASE_URL: "http://127.0.0.1:1",
    },
    (chunk) => chunks.push(chunk),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "SHARED_CONTROLS_CHECK_FAILED",
  );
  process.exitCode = 1;
} finally {
  await fixture?.cleanup();
  await writeFile(
    `reports/step5b-controls-${process.platform}-test-output.txt`,
    Buffer.concat(chunks),
  );
}
process.exit(process.exitCode ?? 0);
