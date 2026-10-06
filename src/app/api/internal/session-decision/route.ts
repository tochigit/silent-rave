import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken, extendSessionIfNeeded } from "@/lib/auth/session";
import { deploymentId, trustedOriginAllowed } from "@/lib/hosting/config";
import { readTrustedContextNode } from "@/lib/hosting/request-context-node";
import { privateHeaders, routePolicy, type Decision } from "@/lib/auth/policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ v: z.literal(1), token: z.string().max(128), surface: z.enum(["admin", "staff"]),
  method: z.string().regex(/^[A-Z]+$/).max(16), originalPathname: z.string().startsWith("/").max(2048),
  effectivePathname: z.string().startsWith("/").max(2048), publicOrigin: z.string().max(512) }).strict();
function reply(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: privateHeaders }); }
export async function POST(request: NextRequest) {
  const secret = process.env.PROXY_AUTH_SECRET;
  const supplied = request.headers.get("x-proxy-auth");
  // Reject before body parsing, context verification or any database work.
  if (!secret || secret.length < 32) return reply({ error: "Service unavailable" }, 503);
  if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return reply({ error: "Unauthorized" }, 401);
  try {
    const context = readTrustedContextNode(request);
    if (context.originalPathname !== "/api/internal/session-decision" || context.method !== "POST") return reply({ error: "Forbidden" }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "JSON required" }, 400);
    const reader = request.body?.getReader(); if (!reader) return reply({ error: "Body required" }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return reply({ error: "Body too large" }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return reply({ error: "Invalid JSON" }, 400); }
    const input = schema.safeParse(body);
    if (!input.success || !trustedOriginAllowed(input.data.publicOrigin, input.data.originalPathname)) return reply({ error: "Invalid decision request" }, 400);
    const value = input.data;
    let policy;
    try { policy = routePolicy(new URL(value.publicOrigin).hostname, value.originalPathname); }
    catch { return reply({ error: "Invalid route policy" }, 400); }
    if (policy.crossSurface || policy.surface !== value.surface || policy.login || policy.effectivePathname !== value.effectivePathname) return reply({ error: "Invalid route policy" }, 400);
    const validated = await validateSessionToken(value.token);
    let decision: Decision["decision"] = "UNAUTHENTICATED";
    let renewExpiresAt: string | undefined;
    if (validated) {
      decision = value.surface === "admin" && validated.user.role !== "OWNER" ? "FORBIDDEN" :
        validated.user.mustChangePassword && !policy.passwordPage ? "PASSWORD_CHANGE_REQUIRED" : "ALLOW";
      if (decision === "ALLOW") {
        renewExpiresAt = (await extendSessionIfNeeded(validated.session))?.toISOString();
        // A concurrent logout/deactivation is checked after the renewal attempt.
        const current = await validateSessionToken(value.token);
        decision = !current ? "UNAUTHENTICATED" :
          value.surface === "admin" && current.user.role !== "OWNER" ? "FORBIDDEN" :
          current.user.mustChangePassword && !policy.passwordPage ? "PASSWORD_CHANGE_REQUIRED" : "ALLOW";
        if (decision !== "ALLOW") renewExpiresAt = undefined;
      }
    }
    return reply({ v: 1, deploymentId: deploymentId(), decision, ...(renewExpiresAt ? { renewExpiresAt } : {}) } satisfies Decision);
  } catch {
    return reply({ error: "Decision service unavailable" }, 503);
  }
}
