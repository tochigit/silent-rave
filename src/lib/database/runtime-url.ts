import { X509Certificate } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SUPABASE_CA_PEM, SUPABASE_CA_FINGERPRINT } from "./supabase-ca";

let certificatePath: string | undefined;
function trustedCertificatePath() {
  if (certificatePath) return certificatePath;
  const certificate = new X509Certificate(SUPABASE_CA_PEM);
  if (!certificate.ca || certificate.fingerprint256.replaceAll(":", "").toLowerCase() !== SUPABASE_CA_FINGERPRINT) {
    throw new Error("Invalid bundled database trust certificate");
  }
  // Only a public root certificate touches serverless temporary disk.
  // No credentials, customer data or durable application files are written.
  const directory = mkdtempSync(path.join(tmpdir(), "silent-rave-ca-"));
  const file = path.join(directory, "supabase-root-2021.pem");
  writeFileSync(file, SUPABASE_CA_PEM, { flag: "wx", mode: 0o400 });
  certificatePath = file;
  return file;
}

export function runtimeDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  if (env.HOST_PLATFORM !== "netlify") return env.DATABASE_URL;
  try {
    const url = new URL(env.DATABASE_URL || "");
    const user = decodeURIComponent(url.username);
    // The packaged-handler acceptance harness owns a disposable loopback DB.
    // This exception cannot reach a provider or use an operator identity.
    if (env.SILENT_RAVE_ISOLATED_FIXTURE === "1" && url.hostname === "127.0.0.1" &&
      url.pathname === "/silentrave_test" && user === "fixture_runtime" && url.password &&
      env.DATABASE_CA_PROVIDER === undefined) return env.DATABASE_URL;
    if (env.DATABASE_CA_PROVIDER !== "supabase" ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) || /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)) ||
      !user || !url.password || /^(postgres|supabase_admin|service_role|sr_runtime)(\.|$)/.test(user) ||
      !url.pathname || url.pathname === "/" || url.hash ||
      url.searchParams.get("sslmode") !== "require" || url.searchParams.get("sslaccept") !== "strict" ||
      url.searchParams.get("connection_limit") !== "1" ||
      (url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") ||
      ["sslmode", "sslaccept", "connection_limit", "pgbouncer"].some(key => url.searchParams.getAll(key).length > 1) ||
      ["sslcert", "sslrootcert", "sslidentity", "sslpassword", "host"].some(key => url.searchParams.has(key))) {
      throw new Error("Invalid configuration");
    }
    url.searchParams.set("sslcert", trustedCertificatePath());
    return url.toString();
  } catch {
    // URL parser errors must never include the credential-bearing input.
    throw new Error("Invalid hosted database configuration");
  }
}
