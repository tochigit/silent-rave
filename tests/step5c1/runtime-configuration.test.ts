import { afterAll, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFileSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { publicDeploymentEnvironment, sanitizedBuildEnvironment } from "../../scripts/build-netlify-env";
import { deploymentId, internalOrigin } from "../../src/lib/hosting/config";
import { runtimeDatabaseUrl } from "../../src/lib/database/runtime-url";
import { SUPABASE_CA_FINGERPRINT } from "../../src/lib/database/supabase-ca";

const identity = { HOST_PLATFORM: "netlify", NODE_ENV: "production", ROOT_DOMAIN: "silentrave.space",
  SR_NETLIFY_DEPLOY_ID: "review123", SR_NETLIFY_SITE_NAME: "silentrave-app" };
test("public build metadata supplies the immutable broker without a Node DEPLOY_ID variable", () => {
  expect(deploymentId(identity)).toBe("review123");
  expect(internalOrigin(identity)).toBe("https://review123--silentrave-app.netlify.app");
  const env = sanitizedBuildEnvironment({ DEPLOY_ID: "review123", SITE_NAME: "silentrave-app",
    DATABASE_URL: "private-runtime-url", RESEND_API_KEY: "private-mail-key", PROXY_AUTH_SECRET: "private-auth-key" });
  expect(env.SR_NETLIFY_DEPLOY_ID).toBe("review123");
  expect(env.SR_NETLIFY_SITE_NAME).toBe("silentrave-app");
  expect(Object.values(env)).not.toContain("private-runtime-url");
  expect(Object.values(env)).not.toContain("private-mail-key");
  expect(Object.values(env)).not.toContain("private-auth-key");
  const nested = sanitizedBuildEnvironment({ ...env, DEPLOY_ID: "offline-cli-deploy", SITE_NAME: "offline-cli-site" });
  expect(nested.SR_NETLIFY_DEPLOY_ID).toBe("review123");
  expect(nested.SR_NETLIFY_SITE_NAME).toBe("silentrave-app");
});
test("partial, malformed and conflicting public deployment identities fail closed", () => {
  for (const env of [{ DEPLOY_ID: "review123" }, { SITE_NAME: "silentrave-app" },
    { DEPLOY_ID: "review123.evil", SITE_NAME: "silentrave-app" },
    { DEPLOY_ID: "review123", SITE_NAME: "evil.test" }]) {
    expect(() => publicDeploymentEnvironment(env)).toThrow("Invalid public deployment metadata");
  }
  for (const env of [{ ...identity, SR_NETLIFY_SITE_NAME: "" }, { ...identity, DEPLOY_ID: "stale" },
    { ...identity, SITE_NAME: "other-site" }]) expect(() => deploymentId(env)).toThrow();
  for (const base of ["https://review123--other-site.netlify.app", "https://stale--silentrave-app.netlify.app",
    "https://silentrave-app.netlify.app", "http://review123--silentrave-app.netlify.app",
    "https://review123--silentrave-app.netlify.app/path"]) {
    expect(() => internalOrigin({ ...identity, AUTH_INTERNAL_BASE_URL: base })).toThrow();
  }
});

const connection = "postgresql://sr_app.project:synthetic-password@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true&connection_limit=1&sslmode=require&sslaccept=strict";
const database = { HOST_PLATFORM: "netlify", DATABASE_CA_PROVIDER: "supabase", DATABASE_URL: connection };
let publicCertificatePath: string | undefined;
test("hosted database uses the bundled pinned CA at an absolute runtime path", () => {
  const url = new URL(runtimeDatabaseUrl(database)!);
  publicCertificatePath = url.searchParams.get("sslcert")!;
  expect(path.isAbsolute(publicCertificatePath)).toBe(true);
  const certificate = new X509Certificate(readFileSync(publicCertificatePath));
  expect(certificate.ca).toBe(true);
  expect(certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(SUPABASE_CA_FINGERPRINT);
  expect(url.username).toBe("sr_app.project");
  expect(url.searchParams.get("sslmode")).toBe("require");
  expect(url.searchParams.get("sslaccept")).toBe("strict");
  expect(runtimeDatabaseUrl(database)).toBe(url.toString());
});
test("hosted database rejects TLS downgrades, operator identities and supplied certificate paths", () => {
  const unsafe = [
    connection.replace("sslmode=require", "sslmode=prefer"),
    connection.replace("sslaccept=strict", "sslaccept=accept_invalid_certs"),
    connection.replace("pgbouncer=true", "pgbouncer=false"),
    connection.replace("sr_app.project", "postgres.project"),
    connection.replace("aws-0-eu-west-2.pooler.supabase.com", "attacker.test"),
    connection + "&sslcert=C%3A%2Fprivate%2Fca.pem",
    connection + "&sslrootcert=alternate.pem",
    connection + "&sslmode=disable",
    connection + "&host=%2Ftmp",
    "invalid-synthetic-password",
  ];
  for (const DATABASE_URL of unsafe) {
    expect(() => runtimeDatabaseUrl({ ...database, DATABASE_URL })).toThrow("Invalid hosted database configuration");
  }
  expect(() => runtimeDatabaseUrl({ ...database, DATABASE_CA_PROVIDER: undefined })).toThrow();
  expect(runtimeDatabaseUrl({ HOST_PLATFORM: "local", DATABASE_URL: "postgresql://fixture@127.0.0.1:5432/local" }))
    .toBe("postgresql://fixture@127.0.0.1:5432/local");
});

test("packaged acceptance exception is limited to its restricted owned loopback fixture", () => {
  const fixture = { HOST_PLATFORM: "netlify", SILENT_RAVE_ISOLATED_FIXTURE: "1",
    DATABASE_URL: "postgresql://fixture_runtime:synthetic@127.0.0.1:54321/silentrave_test" };
  expect(runtimeDatabaseUrl(fixture)).toBe(fixture.DATABASE_URL);
  for (const env of [{ ...fixture, SILENT_RAVE_ISOLATED_FIXTURE: "" },
    { ...fixture, DATABASE_URL: connection },
    { ...fixture, DATABASE_URL: fixture.DATABASE_URL.replace("fixture_runtime", "postgres") },
    { ...fixture, DATABASE_URL: fixture.DATABASE_URL.replace("silentrave_test", "postgres") }]) {
    expect(() => runtimeDatabaseUrl(env)).toThrow("Invalid hosted database configuration");
  }
});
afterAll(() => {
  if (!publicCertificatePath) return;
  const directory = path.resolve(path.dirname(publicCertificatePath));
  if (!directory.startsWith(path.resolve(tmpdir()) + path.sep) || !/^silent-rave-ca-/.test(path.basename(directory))) {
    throw new Error("Refusing certificate fixture cleanup outside its temporary directory");
  }
  // No recursive removal: this fixture owns exactly one public certificate.
  unlinkSync(publicCertificatePath);
  rmdirSync(directory);
});
