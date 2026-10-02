// ─────────────────────────────────────────────────────────────────────────────
// Server startup hook (Next.js instrumentation). Runs once per server process,
// in both `next dev` and `next start` (production), before serving traffic.
//
// Purpose: fail-fast boot-time validation of security-relevant configuration.
// A throw here aborts server startup — the application REFUSES TO START.
//
// Currently asserted:
//   • ALLOW_DEV_ORIGIN=1 together with NODE_ENV=production → refuse to start
//     (the dev Origin-check relaxation must never run in production).
// ─────────────────────────────────────────────────────────────────────────────

export async function register(): Promise<void> {
  const { assertOriginConfigHealthy } = await import("./lib/auth/origin-config");
  assertOriginConfigHealthy();
}
