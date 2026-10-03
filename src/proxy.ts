import { NextResponse, type NextRequest } from "next/server";
import type { StaffRole } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  getSessionUserFromRequest,
  sessionCookieOptions,
  extendSessionIfNeeded,
  type ValidatedSession,
} from "@/lib/auth/session";
import { ADMIN_API_ROLES, STAFF_API_ROLES } from "@/lib/auth/guards";

// ─────────────────────────────────────────────────────────────────────────────
// Silent Rave — proxy (Next.js 16's middleware convention)
//
// Two responsibilities:
//
// 1. Subdomain routing (06-auth-and-roles.md) — unchanged from the foundation
//    step:
//        silentrave.ng        → (public) route group
//        admin.silentrave.ng  → (admin)  route group, internally /admin/*
//        staff.silentrave.ng  → (staff)  route group, internally /staff/*
//
// 2. CENTRAL server-side auth enforcement (this phase) — on every request to
//        /api/admin/*   → requires role OWNER        (else 401 / 403)
//        /api/staff/*   → requires STAFF or OWNER    (else 401 / 403)
//        /admin/*, /staff/* pages (except their /login pages)
//                       → unauthenticated or wrong-role → redirect to that
//                         group's login page; page chrome is never served
//    This covers future routes automatically — a route added without its own
//    guard still cannot leak data. It is defense in depth: the per-route
//    guardApi() call and the per-layout requirePageRole() remain the
//    spec-mandated enforcement points (06-auth-and-roles.md: role is checked
//    server-side on EVERY request, not by hiding UI).
//
// Session sliding refresh also happens here (proxy is the one place that can
// set cookies on every response it returns): a valid session within 3h of its
// 12h expiry is extended and the cookie re-issued.
//
// Local development: ROOT_DOMAIN defaults to `localhost`, so browse
//   http://localhost:3000          → public group
//   http://admin.localhost:3000    → admin group   (*.localhost → loopback)
//   http://staff.localhost:3000    → staff group
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_SUBDOMAIN = "admin";
const STAFF_SUBDOMAIN = "staff";

/** Internal path prefix each subdomain rewrites into (matches the route-group folder layout). */
const ADMIN_PREFIX = "/admin";
const STAFF_PREFIX = "/staff";

type RouteGroup = "public" | "admin" | "staff";

function resolveRootDomain(): string {
  return process.env.ROOT_DOMAIN?.trim().toLowerCase() || "localhost";
}

/** Normalize a Host header to a bare hostname: lowercase, port stripped, IPv6 brackets handled. */
function hostnameFromHostHeader(host: string | null | undefined): string | null {
  if (!host) return null;
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) return null;

  const ipv6Match = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (ipv6Match) return `[${ipv6Match[1]}]`;

  return trimmed.split(":")[0] || null;
}

/**
 * Resolve the route group from a hostname. Only the exact `admin.` / `staff.`
 * subdomains of ROOT_DOMAIN map to the admin/staff groups; everything else
 * (root domain, other subdomains, IPs, unknown proxy hosts) → `public`.
 */
function resolveRouteGroup(hostname: string | null): RouteGroup {
  if (!hostname) return "public";

  const root = resolveRootDomain();
  const match = hostname.match(/^([^.]+)\.(.+)$/);
  if (!match) return "public"; // bare "localhost", IPv6 literal, etc.

  const [, subdomain, parentDomain] = match;
  if (parentDomain !== root) return "public";

  if (subdomain === ADMIN_SUBDOMAIN) return "admin";
  if (subdomain === STAFF_SUBDOMAIN) return "staff";
  return "public";
}

function pathPrefixForGroup(group: RouteGroup): string | null {
  switch (group) {
    case "admin":
      return ADMIN_PREFIX;
    case "staff":
      return STAFF_PREFIX;
    default:
      return null;
  }
}

/** Exact segment match: "/admin", "/admin/…", "/staff", "/staff/…". */
function isUnderPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isLoginPage(pathname: string): boolean {
  return (
    pathname === `${ADMIN_PREFIX}/login` ||
    pathname.startsWith(`${ADMIN_PREFIX}/login/`) ||
    pathname === `${STAFF_PREFIX}/login` ||
    pathname.startsWith(`${STAFF_PREFIX}/login/`)
  );
}

/** Apply the sliding session refresh (same token, extended expiry) to a response. */
async function withSessionRefresh(
  response: NextResponse,
  validated: ValidatedSession
): Promise<NextResponse> {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const expiresAt = await extendSessionIfNeeded(validated.session);
  if (expiresAt) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      validated.token,
      sessionCookieOptions(expiresAt)
    );
  }
  return response;
}

/** Central API enforcement: 401 when unauthenticated, 403 when wrong role. */
async function enforceApi(
  request: NextRequest,
  allowed: StaffRole[]
): Promise<NextResponse> {
  const validated = await getSessionUserFromRequest(request);
  if (!validated) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!allowed.includes(validated.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return withSessionRefresh(NextResponse.next(), validated);
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. Central API enforcement for the two gated API subtrees ────────────
  // (Exact segment match — /api/administrivia must NOT be caught.)
  if (isUnderPath(pathname, "/api/admin")) {
    return enforceApi(request, ADMIN_API_ROLES);
  }
  if (isUnderPath(pathname, "/api/staff")) {
    return enforceApi(request, STAFF_API_ROLES);
  }

  // ── 2. Subdomain routing (host-header inspection) ───────────────────────
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostname = hostnameFromHostHeader(forwardedHost || request.headers.get("host"));

  const group = resolveRouteGroup(hostname);
  const prefix = pathPrefixForGroup(group);
  const viaSubdomain = prefix !== null;

  // Effective internal path after the subdomain rewrite is applied.
  let effectivePath = pathname;
  let rewriteTarget: URL | null = null;
  if (prefix && !isUnderPath(pathname, prefix)) {
    effectivePath = pathname === "/" ? prefix : `${prefix}${pathname}`;
    rewriteTarget = request.nextUrl.clone();
    rewriteTarget.pathname = effectivePath;
  }

  // ── 3. Page auth gate for /admin/* and /staff/* (login pages exempt) ────
  const gatedPrefix = isUnderPath(effectivePath, ADMIN_PREFIX)
    ? ADMIN_PREFIX
    : isUnderPath(effectivePath, STAFF_PREFIX)
      ? STAFF_PREFIX
      : null;

  if (gatedPrefix && !isLoginPage(effectivePath)) {
    const allowed = gatedPrefix === ADMIN_PREFIX ? ADMIN_API_ROLES : STAFF_API_ROLES;
    const validated = await getSessionUserFromRequest(request);

    if (!validated || !allowed.includes(validated.user.role)) {
      // Keep the redirect within the group's URL space:
      //   via subdomain → "/login" (rewrites back to {prefix}/login; avoids
      //                   double-prefixing)
      //   direct path   → "{prefix}/login"
      const loginLocation = viaSubdomain ? "/login" : `${gatedPrefix}/login`;
      return NextResponse.redirect(new URL(loginLocation, request.url));
    }

    return withSessionRefresh(
      rewriteTarget ? NextResponse.rewrite(rewriteTarget) : NextResponse.next(),
      validated
    );
  }

  // ── 4. Default: perform the subdomain rewrite, or pass through ──────────
  if (rewriteTarget) {
    return NextResponse.rewrite(rewriteTarget);
  }
  return NextResponse.next();
}

export const config = {
  // Run on all navigable paths PLUS the two gated API subtrees. Skipped:
  // every other /api route (login/logout stay un-gated at the proxy layer),
  // Next internals, and anything that looks like a static file (has a dot).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
    "/api/admin",
    "/api/admin/:path*",
    "/api/staff",
    "/api/staff/:path*",
  ],
};
