import { NextResponse, type NextRequest } from "next/server";
import { readTrustedContext } from "@/lib/hosting/request-context";
import { routePolicy, privateHeaders, SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/policy";
import { sessionDecision } from "@/lib/auth/proxy-client";
import { publicOrigins } from "@/lib/hosting/config";
import { canonicalPageUrl } from "@/lib/auth/navigation";

function privateResponse(response: NextResponse) {
  for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
  return response;
}
export default async function proxy(request: NextRequest) {
  let context;
  try { context = await readTrustedContext(request); }
  catch { return privateResponse(NextResponse.json({ error: "Untrusted request context" }, { status: 421 })); }
  const originalPathname = context.originalPathname;
  let policy;
  try { policy = routePolicy(context.hostname, originalPathname); }
  catch { return privateResponse(NextResponse.json({ error: "Invalid path" }, { status: 400 })); }
  if (originalPathname.startsWith("/.netlify/")) return privateResponse(NextResponse.json({ error: "Not found" }, { status: 404 }));
  if (policy.crossSurface) return privateResponse(NextResponse.json({ error: "Forbidden" }, { status: 403 }));
  // Only the fixed secret-gated broker is reachable via the immutable service host.
  if (originalPathname === "/api/internal/session-decision") return privateResponse(NextResponse.next());
  const canonical = canonicalPageUrl(context.hostname, originalPathname, request.nextUrl.search, request.method);
  if (canonical) return privateResponse(NextResponse.redirect(canonical));
  const target = new URL(context.origin + request.nextUrl.pathname + request.nextUrl.search);
  target.pathname = policy.effectivePathname;
  const response = policy.effectivePathname !== originalPathname ? NextResponse.rewrite(target) : NextResponse.next();
  if (!policy.surface || policy.login) return policy.surface ? privateResponse(response) : response;
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? "";
    // No session can be authorized without a token. Avoid a remote broker round trip.
    if (!token) return privateResponse(policy.api
      ? NextResponse.json({ error: "Authentication required" }, { status: 401 })
      : NextResponse.redirect(new URL(policy.loginPath, context.origin)));
    const decision = await sessionDecision({ v: 1, token, surface: policy.surface, method: request.method,
      originalPathname, effectivePathname: policy.effectivePathname, publicOrigin: context.origin });
    if (decision.decision === "UNAUTHENTICATED" || decision.decision === "FORBIDDEN") {
      return privateResponse(policy.api
        ? NextResponse.json({ error: decision.decision === "UNAUTHENTICATED" ? "Authentication required" : "Forbidden" }, { status: decision.decision === "UNAUTHENTICATED" ? 401 : 403 })
        : NextResponse.redirect(new URL(policy.loginPath, context.origin)));
    }
    if (decision.decision === "PASSWORD_CHANGE_REQUIRED") {
      return privateResponse(policy.api
        ? NextResponse.json({ error: "Change your temporary password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 })
        : NextResponse.redirect(new URL("/staff/password", publicOrigins()[2])));
    }
    if (decision.renewExpiresAt) response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(new Date(decision.renewExpiresAt)));
    return privateResponse(response);
  } catch { return privateResponse(NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 })); }
}
export const config = {
  // Dotted protected paths and RSC/prefetch are covered. No client skip header.
  matcher: ["/((?!_next/static(?:/|$)|_next/image$|favicon\\.ico$|scanner\\.(?:js|css|webmanifest)$|scanner-sw\\.js$|scanner-icon\\.svg$|scanner-icon-(?:192|512)\\.png$|manifest\\.webmanifest$).*)"],
};
