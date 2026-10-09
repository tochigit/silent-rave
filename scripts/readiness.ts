import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { emailConfig, mailBudgets } from "../src/lib/email/config";

type Env = Record<string, string | undefined>;
type Check = {
  id: string;
  status: "PASS" | "BLOCKED" | "REVIEW";
  detail: string;
};
export type MigrationFingerprint = { name: string; sha256: string };

// Offline inspection only: no runtime DB/storage imports, network, .env reads,
// secret values, or provider calls. A syntactic PASS never proves live readiness.
function parseUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}
function seed32(value: string | undefined): boolean {
  return (
    !!value &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}
function hostname(value: string | undefined): boolean {
  return (
    !!value &&
    value.length <= 253 &&
    value === value.toLowerCase() &&
    !value.endsWith(".localhost") &&
    !/^\d+(\.\d+){3}$/.test(value) &&
    value.split(".").length >= 2 &&
    value
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}
function databaseUrl(value: string | undefined): URL | null {
  const url = parseUrl(value);
  return url &&
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    url.username &&
    url.password &&
    url.pathname.length > 1 &&
    !url.hash &&
    ["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
    ? url
    : null;
}
function loginName(url: URL | null): string {
  try {
    return url ? decodeURIComponent(url.username) : "";
  } catch {
    return "";
  }
}

export function inspectLaunchConfig(env: Env) {
  const checks: Check[] = [];
  const check = (id: string, ok: boolean, detail: string) =>
    checks.push({ id, status: ok ? "PASS" : "BLOCKED", detail });
  check(
    "production-origin-policy",
    env.NODE_ENV === "production" && env.ALLOW_DEV_ORIGIN !== "1",
    "Candidate must use production mode and strict Origin checks.",
  );
  check(
    "root-domain",
    hostname(env.ROOT_DOMAIN),
    "Use the lower-case parent hostname without scheme, port or path.",
  );
  const base = parseUrl(env.PUBLIC_BASE_URL);
  check(
    "public-origin",
    !!base &&
      base.protocol === "https:" &&
      !base.username &&
      !base.password &&
      !base.port &&
      !base.search &&
      !base.hash &&
      base.pathname === "/" &&
      base.hostname === env.ROOT_DOMAIN,
    "Buyer links must use the HTTPS root origin; admin/staff inherit its parent cookie domain.",
  );
  const runtime = databaseUrl(env.DATABASE_URL);
  check(
    "runtime-database",
    !!runtime &&
      runtime.searchParams.get("connection_limit") === "1" &&
      (runtime.port !== "6543" ||
        runtime.searchParams.get("pgbouncer") === "true"),
    "Require authenticated TLS PostgreSQL and connection_limit=1; transaction pooler port 6543 needs pgbouncer=true.",
  );
  const direct = databaseUrl(env.DIRECT_URL);
  check(
    "hosted-database-ca",
    env.HOST_PLATFORM === "netlify" && env.DATABASE_CA_PROVIDER === "supabase" &&
      runtime?.searchParams.get("sslaccept") === "strict" &&
      !["sslcert", "sslrootcert", "sslidentity", "sslpassword", "host"].some(key => runtime?.searchParams.has(key)),
    "Select the bundled Netlify/Supabase CA adapter and strict TLS; hosted runtime URLs must not carry local certificate paths.",
  );
  check(
    "migration-database",
    !!direct && direct.port !== "6543" && !direct.searchParams.has("pgbouncer"),
    "Migration URL must use a TLS direct/session connection, never transaction pooling.",
  );
  check(
    "database-target-pair",
    !!runtime && !!direct && runtime.pathname === direct.pathname,
    "Database names must match; provider project identity still requires manual verification.",
  );
  check(
    "restricted-runtime-identity",
    !!runtime &&
      !!direct &&
      !!loginName(runtime) &&
      loginName(runtime) !== loginName(direct) &&
      !/^(postgres|supabase_admin|service_role|sr_runtime)(\.|$)/.test(
        loginName(runtime),
      ),
    "Use a dedicated runtime login inheriting only sr_runtime, separate from the migration operator; live grants and ownership need verification.",
  );
  check(
    "shared-rate-limits",
    env.RATE_LIMIT_DRIVER === "postgres" && seed32(env.RATE_LIMIT_SECRET),
    "Require the shared PostgreSQL limiter and a canonical server-only 32-byte HMAC key.",
  );
  let budgetsOk = false;
  try {
    mailBudgets(env);
    budgetsOk = true;
  } catch {
    /* fixed diagnostic only */
  }
  check(
    "mail-budgets",
    budgetsOk,
    "Bound app budgets to 1-90/day and 1-2700/month; provider account usage remains a separate gate.",
  );
  check(
    "scheduled-delivery",
    env.EMAIL_KICK_ENABLED === "0",
    "Initial Netlify delivery uses the separately enabled one-minute scheduler; disable best-effort kicks.",
  );
  for (const key of ["STATUS_TOKEN_SECRET", "CRON_SECRET"] as const)
    check(
      key,
      (env[key]?.length ?? 0) >= 32 && env[key] === env[key]?.trim(),
      "Use at least 32 characters from a random server-only secret.",
    );
  check(
    "ticket-signing",
    seed32(env.TICKET_SIGNING_PRIVATE_KEY) &&
      /^[\w-]{1,64}$/.test(env.TICKET_SIGNING_KID ?? ""),
    "Use a canonical base64url 32-byte Ed25519 seed and a valid key ID; retain existing production keys.",
  );
  let rotationOk = true;
  try {
    if (env.TICKET_SIGNING_PUBLIC_KEYS_JSON?.trim()) {
      const keys: unknown = JSON.parse(env.TICKET_SIGNING_PUBLIC_KEYS_JSON);
      const ids = new Set([env.TICKET_SIGNING_KID]);
      rotationOk =
        Array.isArray(keys) &&
        keys.every((key) => {
          if (
            !key ||
            typeof key !== "object" ||
            typeof key.kid !== "string" ||
            !/^[\w-]{1,64}$/.test(key.kid) ||
            ids.has(key.kid) ||
            !seed32(key.publicKey)
          )
            return false;
          ids.add(key.kid);
          return true;
        });
    }
  } catch {
    rotationOk = false;
  }
  check(
    "verification-key-rotation",
    rotationOk,
    "Optional historic public keys must be valid and use distinct key IDs.",
  );
  let emailOk = false;
  try {
    emailOk =
      emailConfig(env).transport === "resend" &&
      seed32(env.EMAIL_PAYLOAD_SECRET);
  } catch {
    /* never print parser errors or inputs */
  }
  check(
    "email-config",
    emailOk,
    "Resend requires valid sender/reply-to, API key, HTTPS buyer origin and a 32-byte payload key.",
  );
  check(
    "webhook-secret",
    !!env.RESEND_WEBHOOK_SECRET?.startsWith("whsec_") &&
      Buffer.from(env.RESEND_WEBHOOK_SECRET.slice(6), "base64").length >= 24,
    "Configure the server-only Svix webhook secret; signature/replay checks still need staged verification.",
  );
  check(
    "storage-driver",
    env.STORAGE_DRIVER === "supabase",
    "Local disk is a fixture adapter; Supabase is required for the intended host.",
  );
  check(
    "storage-signature",
    (env.STORAGE_SIGNING_SECRET?.length ?? 0) >= 32,
    "Retain a random server-only application signing key for session-gated proof reads.",
  );
  let storageConfig = false;
  try {
    const url = new URL(env.SUPABASE_URL ?? "");
    const key = env.SUPABASE_STORAGE_SERVER_KEY ?? "";
    const parts = key.split(".");
    const serverKey =
      /^sb_secret_[A-Za-z0-9_-]+$/.test(key) ||
      (parts.length === 3 &&
        parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)) &&
        JSON.parse(Buffer.from(parts[1], "base64url").toString()).role ===
          "service_role");
    const privateBucket = env.SR_PRIVATE_BUCKET ?? "sr-private",
      banners = env.SR_BANNER_BUCKET ?? "sr-banners";
    storageConfig =
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      serverKey &&
      privateBucket !== banners &&
      [privateBucket, banners].every((b) =>
        /^[a-z0-9][a-z0-9-]{0,62}$/.test(b),
      );
  } catch {
    /* Fixed redacted diagnostic below. */
  }
  check(
    "storage-config",
    storageConfig,
    "Configure the HTTPS Storage origin, server key and separate private/banner buckets; hosted acceptance remains separate.",
  );
  check(
    "public-secret-exposure",
    !Object.entries(env).some(
      ([key, value]) =>
        !!value &&
        /^NEXT_PUBLIC_.*(?:SECRET|PRIVATE|SERVICE_ROLE|STORAGE_SERVER_KEY|DATABASE_URL|DIRECT_URL|RESEND_API_KEY|GOOGLE_PLACES_API_KEY|OWNER_PASSWORD)/.test(
          key,
        ),
    ),
    "Server credentials must never have a NEXT_PUBLIC_ alias.",
  );
  check(
    "fixture-flags",
    env.SILENT_RAVE_ISOLATED_FIXTURE !== "1" &&
      env.PUSH_ADAPTER !== "capture" &&
      !env.OWNER_PASSWORD &&
      !env.OWNER_EMAIL,
    "Exclude fixture/capture and owner-provisioning variables from deployment.",
  );
  const vapid = [
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
    env.VAPID_SUBJECT,
  ];
  check(
    "push-config-pair",
    vapid.every((v) => !v) || vapid.every((v) => !!v),
    "Configure all three VAPID values together, or leave push pending with owner polling.",
  );
  checks.push({
    id: "optional-maps-push",
    status: "REVIEW",
    detail:
      "Configured Places/Maps/push need restrictions, attribution, key validation and device tests; manual directions and polling remain available.",
  });
  return {
    configurationValid: checks.every((item) => item.status !== "BLOCKED"),
    readyForLaunch: false,
    checks,
    codeBlockers: [
      "Durable storage code requires separately approved bucket setup, legacy reconciliation and hosted privacy/durability acceptance.",
      "Shared controls and privacy migrations require exact-head review and separately approved hosted acceptance.",
    ],
    externalReview: [
      "Netlify runtime configuration and one-minute external scheduler.",
      "Hosted migration history, pooler lock behavior, storage privacy and recovery.",
      "Sender DNS, provider quotas, hosted runtime, physical devices and deployed smoke.",
    ],
  };
}

export async function migrationFingerprints(
  root = path.resolve("prisma/migrations"),
): Promise<MigrationFingerprint[]> {
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (
    !directories.length ||
    directories.some((name) => !/^\d{14}_[a-z0-9_]+$/.test(name))
  )
    throw new Error("MIGRATION_INVENTORY_INVALID");
  return Promise.all(
    directories.map(async (name) => ({
      name,
      sha256: createHash("sha256")
        .update(await readFile(path.join(root, name, "migration.sql")))
        .digest("hex"),
    })),
  );
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        {
          mode: "OFFLINE_ONLY",
          ...inspectLaunchConfig(process.env),
          migrations: await migrationFingerprints(),
        },
        null,
        2,
      ),
    );
    // Deliberately blocked until reviewed code and hosted verification are done.
    process.exitCode = 1;
  } catch {
    console.error(
      "READINESS_INSPECTION_FAILED: inspect the tracked migration inventory.",
    );
    process.exitCode = 2;
  }
}
