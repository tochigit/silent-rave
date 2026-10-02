// ─────────────────────────────────────────────────────────────────────────────
// Origin-check DEV RELAXATION — explicit opt-in flag (close-out fix A2).
//
// History: the relaxation used to be gated on NODE_ENV !== "production", which
// made every non-production environment (CI, staging misconfigurations,
// preview shells that forget to set NODE_ENV) silently relaxed. It is now an
// EXPLICIT opt-in: ALLOW_DEV_ORIGIN=1. Default (unset or any other value) is
// STRICT — the admin/staff/auth Origin rules of 06-auth-and-roles.md apply
// verbatim.
//
// Boot guard: the application REFUSES TO START when ALLOW_DEV_ORIGIN=1 is set
// while NODE_ENV=production (assertOriginConfigHealthy, called from
// src/instrumentation.ts register() at server startup). The dev relaxation
// must never be able to run in production.
//
// What the relaxation buys in dev (see src/lib/auth/origin.ts):
//   • admin/staff surfaces additionally accept the ROOT host — direct-path
//     browsing (localhost:3000/admin) keeps working.
//   • the auth surface accepts ANY request host when Origin matches it exactly
//     (same-origin) — the sandbox preview gateway serves the app under an
//     external hostname that is not ROOT_DOMAIN=localhost.
// ─────────────────────────────────────────────────────────────────────────────

/** Only the exact value "1" opts in — anything else (incl. "true", "yes", "") stays strict. */
export function isDevOriginRelaxationEnabled(): boolean {
  return process.env.ALLOW_DEV_ORIGIN === "1";
}

/**
 * Startup assertion: the app refuses to boot when the dev relaxation is
 * enabled in production. Called from instrumentation.register() — a throw
 * there aborts server startup.
 */
export function assertOriginConfigHealthy(): void {
  if (isDevOriginRelaxationEnabled() && process.env.NODE_ENV === "production") {
    throw new Error(
      "FATAL Origin configuration: ALLOW_DEV_ORIGIN=1 is set while NODE_ENV=production. " +
        "The dev-only Origin-check relaxation must never run in production. " +
        "Unset ALLOW_DEV_ORIGIN (the default is strict) and restart."
    );
  }
}
