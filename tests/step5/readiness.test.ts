import { expect, test } from "bun:test";
import {
  inspectLaunchConfig,
  migrationFingerprints,
} from "../../scripts/readiness";
import { assertFixtureEnvironment } from "../../scripts/fixture";

const secret = Buffer.alloc(32, 7).toString("base64url");
const candidate = {
  NODE_ENV: "production",
  HOST_PLATFORM: "netlify",
  DATABASE_CA_PROVIDER: "supabase",
  ROOT_DOMAIN: "silentrave.space",
  PUBLIC_BASE_URL: "https://silentrave.space",
  DATABASE_URL:
    "postgresql://candidate:dummy-secret@pooler.example.test:6543/postgres?sslmode=require&sslaccept=strict&pgbouncer=true&connection_limit=1",
  DIRECT_URL:
    "postgresql://migration_operator:dummy-secret@pooler.example.test:5432/postgres?sslmode=require",
  RATE_LIMIT_DRIVER: "postgres",
  RATE_LIMIT_SECRET: secret,
  EMAIL_KICK_ENABLED: "0",
  EMAIL_DAILY_BUDGET: "90",
  EMAIL_MONTHLY_BUDGET: "2700",
  STATUS_TOKEN_SECRET: secret,
  CRON_SECRET: secret,
  STORAGE_SIGNING_SECRET: secret,
  TICKET_SIGNING_PRIVATE_KEY: secret,
  TICKET_SIGNING_KID: "preflight",
  EMAIL_TRANSPORT: "resend",
  RESEND_API_KEY: "dummy-resend-secret",
  EMAIL_FROM: "tickets@example.test",
  EMAIL_REPLY_TO: "help@example.test",
  EMAIL_PAYLOAD_SECRET: secret,
  RESEND_WEBHOOK_SECRET: "whsec_" + Buffer.alloc(32, 4).toString("base64"),
  STORAGE_DRIVER: "supabase",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_STORAGE_SERVER_KEY: "sb_secret_synthetic_candidate",
  SR_PRIVATE_BUCKET: "sr-private",
  SR_BANNER_BUCKET: "sr-banners",
};
const blocked = (overrides: Record<string, string>, id: string) =>
  expect(
    inspectLaunchConfig({ ...candidate, ...overrides }).checks.find(
      (c) => c.id === id,
    )?.status,
  ).toBe("BLOCKED");

test("valid candidate syntax remains blocked by code and live launch prerequisites", () => {
  const result = inspectLaunchConfig(candidate);
  expect(result.configurationValid).toBe(true);
  expect(result.readyForLaunch).toBe(false);
  expect(result.codeBlockers.length).toBeGreaterThan(0);
  expect(inspectLaunchConfig({}).configurationValid).toBe(false);
});
test("rejects unsafe origins, parent domains and preview-host buyer links", () => {
  for (const value of [
    "localhost",
    "127.0.0.1",
    "https://silentrave.space",
    "silentrave.space:3000",
    ".silentrave.space",
    "SILENTRAVE.SPACE",
    "app.localhost",
  ])
    blocked({ ROOT_DOMAIN: value }, "root-domain");
  for (const value of [
    "http://silentrave.space",
    "https://admin.silentrave.space",
    "https://user:pass@silentrave.space",
    "https://silentrave.space/order",
    "https://silentrave.space?t=secret",
    "https://silentrave.space:3000",
    "https://preview.vercel.app",
  ])
    blocked({ PUBLIC_BASE_URL: value }, "public-origin");
  blocked({ ALLOW_DEV_ORIGIN: "1" }, "production-origin-policy");
});
test("requires TLS, bounded runtime connections and migration-safe pooler split", () => {
  blocked({ DATABASE_CA_PROVIDER: "" }, "hosted-database-ca");
  blocked({ DATABASE_URL: candidate.DATABASE_URL + "&sslcert=C%3A%2Foperator%2Fca.pem" }, "hosted-database-ca");
  blocked(
    {
      DATABASE_URL: candidate.DATABASE_URL.replace(
        "sslmode=require",
        "sslmode=disable",
      ),
    },
    "runtime-database",
  );
  blocked(
    {
      DATABASE_URL: candidate.DATABASE_URL.replace(
        "pgbouncer=true",
        "pgbouncer=false",
      ),
    },
    "runtime-database",
  );
  blocked(
    {
      DATABASE_URL: candidate.DATABASE_URL.replace(
        "connection_limit=1",
        "connection_limit=8",
      ),
    },
    "runtime-database",
  );
  blocked({ DIRECT_URL: candidate.DATABASE_URL }, "migration-database");
  blocked(
    {
      DATABASE_URL: candidate.DATABASE_URL.replace(
        "pooler.example.test",
        "127.0.0.1",
      ),
    },
    "runtime-database",
  );
  blocked(
    { DIRECT_URL: candidate.DIRECT_URL.replace("/postgres?", "/different?") },
    "database-target-pair",
  );
});
test("shared controls reject privileged runtime users, local limiters, unsafe quotas and kick delivery", () => {
  blocked({ DATABASE_URL: candidate.DATABASE_URL.replace("candidate:", "%ZZ:") }, "restricted-runtime-identity");
  blocked(
    {
      DIRECT_URL: candidate.DIRECT_URL.replace(
        "migration_operator",
        "candidate",
      ),
    },
    "restricted-runtime-identity",
  );
  blocked(
    {
      DATABASE_URL: candidate.DATABASE_URL.replace(
        "candidate:",
        "postgres.project:",
      ),
    },
    "restricted-runtime-identity",
  );
  blocked({ RATE_LIMIT_DRIVER: "memory" }, "shared-rate-limits");
  blocked({ RATE_LIMIT_SECRET: "short" }, "shared-rate-limits");
  blocked({ EMAIL_DAILY_BUDGET: "91" }, "mail-budgets");
  blocked({ EMAIL_MONTHLY_BUDGET: "2701" }, "mail-budgets");
  blocked({ EMAIL_KICK_ENABLED: "1" }, "scheduled-delivery");
});
test("malformed and public secrets cannot leak through diagnostics", () => {
  const marker = "UNIQUE-SECRET-DO-NOT-PRINT";
  const result = inspectLaunchConfig({
    ...candidate,
    EMAIL_FROM: marker,
    DIRECT_URL: marker,
    TICKET_SIGNING_PUBLIC_KEYS_JSON: marker,
    NEXT_PUBLIC_SERVICE_ROLE_KEY: marker,
  });
  expect(JSON.stringify(result)).not.toContain(marker);
  expect(JSON.stringify(inspectLaunchConfig(candidate))).not.toContain(secret);
  blocked({ NEXT_PUBLIC_SERVICE_ROLE_KEY: marker }, "public-secret-exposure");
  blocked({ TICKET_SIGNING_PRIVATE_KEY: secret + "=" }, "ticket-signing");
  blocked({ EMAIL_PAYLOAD_SECRET: "short" }, "email-config");
  blocked({ CRON_SECRET: "short" }, "CRON_SECRET");
  blocked({ STORAGE_SIGNING_SECRET: "short" }, "storage-signature");
  blocked(
    {
      TICKET_SIGNING_PUBLIC_KEYS_JSON: JSON.stringify([
        { kid: "preflight", publicKey: secret },
      ]),
    },
    "verification-key-rotation",
  );
});
test("refuses fixture deployment and incomplete push while allowing manual fallback", () => {
  blocked({ EMAIL_TRANSPORT: "capture" }, "email-config");
  blocked({ PUSH_ADAPTER: "capture" }, "fixture-flags");
  blocked({ OWNER_PASSWORD: "fixture-password" }, "fixture-flags");
  blocked({ STORAGE_DRIVER: "local" }, "storage-driver");
  blocked({ SUPABASE_URL: "http://127.0.0.1:1" }, "storage-config");
  blocked(
    { SUPABASE_STORAGE_SERVER_KEY: "sb_publishable_fixture" },
    "storage-config",
  );
  blocked({ SR_PRIVATE_BUCKET: "sr-banners" }, "storage-config");
  blocked(
    { NEXT_PUBLIC_SUPABASE_STORAGE_SERVER_KEY: "sb_secret_fixture" },
    "public-secret-exposure",
  );
  blocked({ VAPID_PUBLIC_KEY: "only-one-key" }, "push-config-pair");
  expect(inspectLaunchConfig(candidate).configurationValid).toBe(true);
});
test("migration fingerprints cover the chronological additive forward chain", async () => {
  const migrations = await migrationFingerprints();
  expect(migrations.map((m) => m.name)).toEqual([
    "20260930000000_v2_1_baseline",
    "20261002000000_phase4_email_state",
    "20261002010000_step3_content_payment_snapshot",
    "20261003000000_step4_staff_password",
    "20261006000000_step5_storage_accounting",
    "20261008000000_step5_shared_rate_limits",
    "20261008000100_step5_mail_quotas",
    "20261008000200_step5_private_runtime",
  ]);
  for (const migration of migrations)
    expect(migration.sha256).toMatch(/^[a-f0-9]{64}$/);
});
test("database fixture guard rejects hosted, malformed and production targets", () => {
  for (const key of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"])
    expect(() =>
      assertFixtureEnvironment({ [key]: candidate.DATABASE_URL }),
    ).toThrow();
  expect(() => assertFixtureEnvironment({ DATABASE_URL: "invalid" })).toThrow();
  expect(() => assertFixtureEnvironment({ NODE_ENV: "production" })).toThrow();
  expect(() =>
    assertFixtureEnvironment({
      DATABASE_URL: "postgresql://dummy@127.0.0.1:5432/fixture",
    }),
  ).not.toThrow();
});
