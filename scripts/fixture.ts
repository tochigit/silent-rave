import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

export async function startFixture(capture?: (chunk: Uint8Array) => void) {
  assertFixtureEnvironment(); // before loading native binaries or writing anything
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  await mkdir(runtimeRoot, { recursive: true });
  const runDir = await mkdtemp(path.join(runtimeRoot, "run-"));
  if (path.dirname(runDir) !== runtimeRoot) throw new Error("Unsafe fixture directory.");
  const pgPort = await freePort();
  const dbPassword = randomBytes(24).toString("hex");
  let startupLog = "";
  let phase = "initialization";
  const recordStartup = (message: unknown) => {
    startupLog = (startupLog + String(message).replaceAll(dbPassword, "[redacted]")).slice(-4000);
  };
  const postgres = new EmbeddedPostgres({
    databaseDir: path.join(runDir, "postgres"), port: pgPort, user: "postgres",
    password: dbPassword, authMethod: "scram-sha-256", persistent: true,
    // Windows otherwise inherits WIN1252; migrations and buyer names need UTF-8.
    initdbFlags: ["--encoding=UTF8"],
    // Synchronous I/O avoids PostgreSQL 18's extra Windows I/O worker process.
    postgresFlags: ["-h", "127.0.0.1", "-c", "io_method=sync"], onLog: recordStartup, onError: recordStartup,
  });
  const databaseUrl = `postgresql://postgres:${dbPassword}@127.0.0.1:${pgPort}/silentrave_test`;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  Object.assign(env, {
    NODE_ENV: "development", DATABASE_URL: `${databaseUrl}?connection_limit=8`,
    DIRECT_URL: databaseUrl, TEST_DATABASE_URL: `${databaseUrl}?connection_limit=8`,
    ROOT_DOMAIN: "localhost", ALLOW_DEV_ORIGIN: "", NEXT_TELEMETRY_DISABLED: "1",
    STATUS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
    STORAGE_SIGNING_SECRET: randomBytes(32).toString("base64url"),
    CRON_SECRET: randomBytes(24).toString("base64url"),
    TICKET_SIGNING_PRIVATE_KEY: randomBytes(32).toString("base64url"),
    TICKET_SIGNING_KID: "fixture", TICKET_SIGNING_PUBLIC_KEYS_JSON: "",
    STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: path.join(runDir, "storage"),
    EMAIL_TRANSPORT: "capture", RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: "",
    OWNER_EMAIL: "owner@silentrave.ng", OWNER_PASSWORD: "silentrave-dev-owner", OWNER_NAME: "Fixture Owner",
    INITIALIZE_IP_RATE_LIMIT_PER_HOUR: "10",
  });
  let started = false;
  const cleanup = async () => {
    if (started) { await postgres.stop(); started = false; }
    if (path.dirname(path.resolve(runDir)) !== runtimeRoot) throw new Error("Unsafe cleanup directory.");
    await rm(runDir, { recursive: true, force: true });
  };
  try {
    const notice = "Fixture: isolated loopback PostgreSQL; root .env is untouched.\n";
    process.stdout.write(notice); capture?.(Buffer.from(notice));
    await postgres.initialise();
    phase = "startup";
    await postgres.start();
    started = true;
    phase = "database creation/migration/seeding";
    await postgres.createDatabase("silentrave_test");
    await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "generate"], env, capture);
    await runCommand([process.execPath, "--no-env-file", "node_modules/prisma/build/index.js", "migrate", "deploy"], env, capture);
    await runCommand([process.execPath, "--no-env-file", "prisma/seed-owner.ts"], env, capture);
    await runCommand([process.execPath, "--no-env-file", "prisma/seed-dev-event.ts"], env, capture);
    return { env, runDir, cleanup };
  } catch (error) {
    await cleanup();
    if (!(error instanceof Error)) {
      throw new Error(`Fixture ${phase} failed: native process exited.\n${startupLog}`);
    }
    throw error;
  }
}
