import { existsSync } from "node:fs";
import path from "node:path";
export function publicDeploymentEnvironment(input: Record<string, string | undefined>) {
  // A second build wrapper preserves the identity captured by the first one.
  // Offline Netlify CLI adds its own synthetic platform values afterwards.
  const id = input.SR_NETLIFY_DEPLOY_ID || input.DEPLOY_ID;
  const site = input.SR_NETLIFY_SITE_NAME || input.SITE_NAME;
  if (!id && !site) return {};
  if (!id || !site || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site)) {
    throw new Error("Invalid public deployment metadata");
  }
  return { SR_NETLIFY_DEPLOY_ID: id, SR_NETLIFY_SITE_NAME: site };
}
export function sanitizedBuildEnvironment(input: Record<string, string | undefined>) {
  const environment: Record<string, string> = {};
  // An allowlist prevents future provider/owner/fixture keys from leaking too.
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR", "CI", "TERM"])
    if (input[key] !== undefined) environment[key] = input[key]!;
  return { ...environment, ...publicDeploymentEnvironment(input), NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "postgresql://build@127.0.0.1:1/silent_rave_build",
    DIRECT_URL: "postgresql://build@127.0.0.1:1/silent_rave_build" };
}
export function assertEnvironmentFreeCheckout(root = process.cwd()) {
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local", "prisma/.env"])
    if (existsSync(path.resolve(root, file))) throw new Error("Netlify build requires a checkout without dotenv files.");
}
