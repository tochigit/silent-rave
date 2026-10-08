// Fail closed for direct invocation; the runner supplies an isolated environment.
// Never load the real project's .env into a test process.
const databaseUrl = process.env.TEST_DATABASE_URL;
const baseUrl = process.env.TEST_BASE_URL;
if (!databaseUrl || !baseUrl || process.env.NODE_ENV === "production") {
  throw new Error(
    "Use bun run test:phase3b: an isolated local test environment is required.",
  );
}
const database = new URL(databaseUrl);
const app = new URL(baseUrl);
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/silentrave_test" ||
  app.hostname !== "127.0.0.1" ||
  (process.env.DATABASE_URL !== databaseUrl &&
    process.env.DATABASE_URL !== process.env.TEST_RUNTIME_DATABASE_URL)
) {
  throw new Error("Refusing tests outside the isolated loopback fixture.");
}
if (process.env.DATABASE_URL !== databaseUrl) {
  const runtime = new URL(process.env.DATABASE_URL!);
  if (
    runtime.hostname !== database.hostname ||
    runtime.port !== database.port ||
    runtime.pathname !== database.pathname ||
    runtime.username !== "fixture_runtime"
  )
    throw new Error("Restricted tests require the same owned fixture target.");
}
