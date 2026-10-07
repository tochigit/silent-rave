import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, cp, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

const runtimeRoot = path.resolve(".test-runtime");

export function assertFixtureEnvironment(env = process.env): void {
  if (env.NODE_ENV === "production") {
    throw new Error("NODE_ENV=production: refusing to run the DEV-ONLY fixture.");
  }
  for (const key of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"] as const) {
    if (!env[key]) continue;
    let url: URL;
    try { url = new URL(env[key]); } catch {
      throw new Error(`${key}: refusing an invalid database URL.`);
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw new Error(`${key}: refusing a database that is not the embedded local server.`);
    }
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local port."));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export async function runCommand(args: string[], env: Record<string, string>, capture?: (chunk: Uint8Array) => void): Promise<void> {
  const child = Bun.spawn(args, { env, stdout: capture ? "pipe" : "inherit", stderr: capture ? "pipe" : "inherit", stdin: "ignore" });
  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    for await (const chunk of stream) { process.stdout.write(chunk); capture?.(chunk); }
  };
  const [code] = await Promise.all([
    child.exited,
    capture ? pump(child.stdout as ReadableStream<Uint8Array>) : Promise.resolve(),
    capture ? pump(child.stderr as ReadableStream<Uint8Array>) : Promise.resolve(),
  ]);
  if (code !== 0) throw new Error(`Command failed (${code}): ${args.slice(1).join(" ")}`);
}

async function runPgControl(args: string[], env: Record<string, string>, logFile: string, capture?: (chunk: Uint8Array) => void) {
  // Windows postgres workers inherit pg_ctl's output handles. A pipe would
  // stay open until the database stops, so startup must wait on the process
  // exit rather than pipe EOF. The owned file also preserves control errors.
  const output = await open(logFile, "w");
  let code: number;
  try {
    const child = Bun.spawn(args, { env, stdout: output.fd, stderr: output.fd, stdin: "ignore" });
    code = await child.exited;
  } finally { await output.close(); }
  const content = await readFile(logFile);
  process.stdout.write(content); capture?.(content);
  if (code !== 0) throw new Error(`pg_ctl failed (${code}).`);
}

export async function startFixture(capture?: (chunk: Uint8Array) => void, legacyStorage = false) {
  assertFixtureEnvironment(); // before loading native binaries or writing anything
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  await mkdir(runtimeRoot, { recursive: true });
  const runDir = await mkdtemp(path.join(runtimeRoot, "run-"));
  if (path.dirname(runDir) !== runtimeRoot) throw new Error("Unsafe fixture directory.");
  const pgPort = await freePort();
  const databaseDir = path.join(runDir, "postgres");
  const postgresLog = path.join(runDir, "postgres.log");
  const dbPassword = randomBytes(24).toString("hex");
  let startupLog = "";
  let phase = "initialization";
  const recordStartup = (message: unknown) => {
    startupLog = (startupLog + String(message).replaceAll(dbPassword, "[redacted]")).slice(-4000);
  };
  const postgres = new EmbeddedPostgres({
    databaseDir, port: pgPort, user: "postgres",
    password: dbPassword, authMethod: "scram-sha-256", persistent: true,
    // Windows otherwise inherits WIN1252; migrations and buyer names need UTF-8.
    // This newly owned cluster is disposable. Skip initialization-only fsync;
    // normal database fsync/transactions stay enabled during acceptance tests.
    initdbFlags: ["--encoding=UTF8", "--no-sync"],
    // Synchronous I/O avoids PostgreSQL 18's extra Windows I/O worker process.
    postgresFlags: ["-h", "127.0.0.1", "-c", "io_method=sync"], onLog: recordStartup, onError: recordStartup,
  });
  const databaseUrl = `postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/silentrave_test`;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  Object.assign(env, {
    NODE_ENV: "development", SILENT_RAVE_ISOLATED_FIXTURE: "1", DATABASE_URL: `${databaseUrl}?connection_limit=8`,
    DIRECT_URL: databaseUrl, TEST_DATABASE_URL: `${databaseUrl}?connection_limit=8`,
    ROOT_DOMAIN: "localhost", HOST_PLATFORM: "local", AUTH_INTERNAL_BASE_URL: "", PROXY_AUTH_SECRET: randomBytes(32).toString("base64url"), NETLIFY_INGRESS_SECRET: "", DEPLOY_ID: "",
    ALLOW_DEV_ORIGIN: "", NEXT_TELEMETRY_DISABLED: "1", CHECKPOINT_DISABLE: "1",
    STATUS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
    STORAGE_SIGNING_SECRET: randomBytes(32).toString("base64url"),
    CRON_SECRET: randomBytes(24).toString("base64url"),
    TICKET_SIGNING_PRIVATE_KEY: randomBytes(32).toString("base64url"),
    TICKET_SIGNING_KID: "fixture", TICKET_SIGNING_PUBLIC_KEYS_JSON: "",
    STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(runDir, "storage"),
    SUPABASE_URL: "", SUPABASE_STORAGE_SERVER_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", SR_PRIVATE_BUCKET: "", SR_BANNER_BUCKET: "",
    EMAIL_TRANSPORT: "capture", RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: "whsec_" + randomBytes(32).toString("base64"),
    EMAIL_FROM: "tickets@example.test", EMAIL_REPLY_TO: "help@example.test", PUBLIC_BASE_URL: "http://localhost:3000",
    EMAIL_PAYLOAD_SECRET: randomBytes(32).toString("base64url"), EMAIL_KICK_ENABLED: "0",
    PUSH_ADAPTER: "capture", PUSH_CAPTURE_DIR: path.join(runDir, "push-capture"), VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "", GOOGLE_PLACES_API_KEY: "",
    OWNER_EMAIL: "owner@silentrave.ng", OWNER_PASSWORD: "silentrave-dev-owner", OWNER_NAME: "Fixture Owner",
    INITIALIZE_IP_RATE_LIMIT_PER_HOUR: "10",
  });
  let started = false;
  let pgCtl: string | undefined;
  const cleanup = async () => {
    if (path.dirname(path.resolve(runDir)) !== runtimeRoot) throw new Error("Unsafe cleanup directory.");
    const hasPid = pgCtl && await readFile(path.join(databaseDir, "postmaster.pid"), "utf8").then(() => true, () => false);
    if (pgCtl && (started || hasPid)) {
      // pg_ctl waits for all workers in this exact owned cluster to stop.
      // Cold Windows filesystem sync was observed taking 162 seconds. This is
      // shutdown of the owned disposable cluster, not a test assertion retry.
      await runPgControl([pgCtl, "-D", databaseDir, "-w", "-t", "300", "-m", "fast", "stop"], env, path.join(runDir, "control-stop.log"), capture);
      started = false;
    } else if (started) { await postgres.stop(); started = false; }
    await rm(runDir, { recursive: true, force: true });
  };
  try {
    const notice = "Fixture: isolated loopback PostgreSQL; root .env is untouched.\n";
    process.stdout.write(notice); capture?.(Buffer.from(notice));
    if (process.platform === "win32") {
      // The module is optional on Linux; resolve it only on supported Windows.
      const binariesModule: string = "@embedded-postgres/windows-x64";
      pgCtl = (await import(binariesModule)).pg_ctl;
    }
    await postgres.initialise();
    phase = "startup";
    if (pgCtl) {
      // Windows CI runs as runneradmin. pg_ctl starts postgres with a restricted
      // token; launching postgres.exe directly is rejected by PostgreSQL.
      await runPgControl([pgCtl, "-D", databaseDir, "-w", "-t", "60", "-l", postgresLog,
        "-o", `-p ${pgPort} -h 127.0.0.1 -c io_method=sync`, "start"], env, path.join(runDir, "control-start.log"), capture);
    } else { await postgres.start(); }
    started = true;
    phase = "database creation/migration/seeding";
    if (pgCtl) {
      const client = postgres.getPgClient("postgres", "127.0.0.1");
      try { await client.connect(); await client.query("CREATE DATABASE silentrave_test"); }
      finally { await client.end(); }
    } else { await postgres.createDatabase("silentrave_test"); }
    await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "generate"], env, capture);
    let migrationArgs: string[] = [];
    if (legacyStorage) {
      // A temporary copy of the four unchanged old migrations, exclusively for additive backfill acceptance.
      const legacy = path.join(runDir, "legacy-prisma"); await mkdir(path.join(legacy, "migrations"), { recursive: true });
      await writeFile(path.join(legacy, "schema.prisma"), await readFile("prisma/schema.prisma"));
      for (const name of await readdir("prisma/migrations")) {
        if (name === "20261006000000_step5_storage_accounting") continue;
        await cp(path.join("prisma/migrations", name), path.join(legacy, "migrations", name), { recursive: true });
      }
      migrationArgs = ["--schema", path.join(legacy, "schema.prisma")];
    }
    await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "migrate", "deploy", ...migrationArgs], env, capture);
    await runCommand([process.execPath, "--no-env-file", "prisma/seed-owner.ts"], env, capture);
    await runCommand([process.execPath, "--no-env-file", "prisma/seed-dev-event.ts"], env, capture);
    return { env, runDir, cleanup };
  } catch (error) {
    const nativeLog = await readFile(postgresLog, "utf8").catch(() => "");
    recordStartup(nativeLog);
    await cleanup();
    if (phase === "startup" || !(error instanceof Error)) {
      throw new Error(`Fixture ${phase} failed: ${error instanceof Error ? error.message : "native process exited"}.\n${startupLog}`);
    }
    throw error;
  }
}
