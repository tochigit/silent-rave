import { existsSync } from "node:fs";
import path from "node:path";
export function sanitizedBuildEnvironment(input: Record<string, string | undefined>) {
  const environment: Record<string, string> = {};
  // An allowlist prevents future provider/owner/fixture keys from leaking too.
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "BUN_INSTALL", "BUN_INSTALL_CACHE_DIR", "CI", "TERM"])
    if (input[key] !== undefined) environment[key] = input[key]!;
  return { ...environment, NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: "postgresql://build@127.0.0.1:1/silent_rave_build",
    DIRECT_URL: "postgresql://build@127.0.0.1:1/silent_rave_build" };
}
export function assertEnvironmentFreeCheckout(root = process.cwd()) {
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local", "prisma/.env"])
    if (existsSync(path.resolve(root, file))) throw new Error("Netlify build requires a checkout without dotenv files.");
}
