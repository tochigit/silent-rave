import { NextResponse, type NextRequest } from "next/server";
import { isDevOriginRelaxationEnabled } from "./origin-config";

// ─────────────────────────────────────────────────────────────────────────────
// Origin check — shared helper (06-auth-and-roles.md "CSRF and Origin checks").
//
// The session cookie is scoped to the ROOT domain, so SameSite=Lax does NOT
// separate admin./staff./public (same-site). Every state-changing admin and
// staff request (POST/PATCH/PUT/DELETE) must verify the Origin header matches
// the expected host for that surface and reject otherwise.
//
// Surfaces:
//   • admin → expected host: admin.ROOT_DOMAIN
//   • staff → expected host: staff.ROOT_DOMAIN
//   • auth  → login/logout forms exist on BOTH admin and staff surfaces (plus
//             direct-path /admin/login, /staff/login on the root host), so the
//             allowed set is ROOT_DOMAIN + admin. + staff. subdomains.
//
// Dev conveniences (EXPLICIT OPT-IN: ALLOW_DEV_ORIGIN=1 — default is STRICT;
// the app refuses to start if the flag is set with NODE_ENV=production, see
// src/lib/auth/origin-config.ts):
//   • admin/staff surfaces additionally accept the ROOT host — direct-path
//     browsing (localhost:3000/admin) keeps working.
//   • the auth surface accepts ANY request host as long as the Origin matches
//     it exactly (same-origin check) — the sandbox preview gateway serves the
//     app under an external hostname that is not ROOT_DOMAIN=localhost.
// Without the flag (any environment, dev included) 06 applies verbatim:
// only the surface's own host.
//
// Exemptions (documented, not accidental):
//   • GET/HEAD/OPTIONS — 06 scopes the check to state-changing methods.
//   • /api/internal/* — machine routes guarded by CRON_SECRET (no ambient
//     cookie credential; CSRF does not apply).
//   • Public routes (checkout initialize, proof, lookup) — no ambient
//     credential: proof requires the buyer's status_token (a bearer secret
//     supplied per request), initialize/lookup are unauthenticated. 06 scopes
//     the requirement to admin and staff routes.
//   • /api/auth/login — NOT exempt: it is a state-changing POST (creates a
//     session) and browsers always send Origin on cross-origin POSTs, so the
//     same-origin property is enforceable. A missing Origin is rejected
//     (fail-closed).
// ─────────────────────────────────────────────────────────────────────────────

export type OriginSurface = "admin" | "staff" | "auth";

const STATE_CHANGING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export type OriginCheckResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

function rootDomain(): string {
  return (process.env.ROOT_DOMAIN ?? "localhost").trim().toLowerCase();
}

function hostnameFromHeader(host: string | null | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;
  const ipv6Match = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (ipv6Match) return `[${ipv6Match[1]}]`;
  return trimmed.split(":")[0] || null;
}

function allowedHostnamesFor(surface: OriginSurface, devRelax: boolean): string[] | null {
  const root = rootDomain();
  const adminHost = `admin.${root}`;
  const staffHost = `staff.${root}`;
  switch (surface) {
    case "admin":
      return devRelax ? [adminHost, root] : [adminHost];
    case "staff":
      return devRelax ? [staffHost, root] : [staffHost];
    case "auth":
      // relaxed dev: any host allowed → same-origin check only (see header)
      return devRelax ? null : [root, adminHost, staffHost];
  }
}

/**
 * Enforce the Origin check for a state-changing request on the given surface.
 * Call at the top of every mutating admin/staff/auth route handler, AFTER
 * guardApi (authz) — or before, order does not matter for correctness.
 */
export function originCheck(request: NextRequest, surface: OriginSurface): OriginCheckResult {
  const method = request.method.toUpperCase();
  if (!STATE_CHANGING.has(method)) return { ok: true };

  const origin = request.headers.get("origin");
  if (!origin) {
    // Fail-closed: browsers always send Origin on cross-origin POSTs and on
    // same-origin POSTs from forms/fetch. A mutating request without Origin
    // is not a browser we want to trust.
    return {
      ok: false,
      response: NextResponse.json({ error: "Origin required" }, { status: 403 }),
    };
  }

  let originHostname: string | null = null;
  try {
    const url = new URL(origin);
    // Only http(s) origins are meaningful here; others (null, data:) reject.
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      originHostname = null;
    } else {
      originHostname = url.hostname.toLowerCase();
    }
  } catch {
    originHostname = null;
  }
  if (!originHostname) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid Origin" }, { status: 403 }),
    };
  }

  // Explicit opt-in relaxation (ALLOW_DEV_ORIGIN=1) — the flag is the SOLE
  // switch (close-out fix A2 removed the old NODE_ENV≠production gate: an
  // ambient NODE_ENV value must never silently decide the security posture).
  // Production safety is enforced at BOOT instead: instrumentation refuses to
  // start when the flag is set together with NODE_ENV=production
  // (assertOriginConfigHealthy), so this relaxed branch is unreachable in a
  // production boot.
  const devRelax = isDevOriginRelaxationEnabled();
  const allowed = allowedHostnamesFor(surface, devRelax);

  if (allowed === null) {
    // Relaxed dev auth surface: Origin must exactly match the host the request
    // arrived on (same-origin through any gateway/preview hostname).
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? null;
    const requestHost = hostnameFromHeader(forwardedHost || request.headers.get("host"));
    if (!requestHost || originHostname !== requestHost) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Origin not allowed" }, { status: 403 }),
      };
    }
    return { ok: true };
  }

  if (!allowed.includes(originHostname)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Origin not allowed" }, { status: 403 }),
    };
  }

  return { ok: true };
}
