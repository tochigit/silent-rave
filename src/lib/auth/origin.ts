import { NextResponse, type NextRequest } from "next/server";
import { publicOrigins, localMode } from "@/lib/hosting/config";
import { readTrustedContextNode } from "@/lib/hosting/request-context-node";
import { privateHeaders } from "./policy";
export type OriginSurface = "admin" | "staff" | "auth";
export type OriginCheckResult = { ok: true } | { ok: false; response: NextResponse };
export function originCheck(request: NextRequest, surface: OriginSurface): OriginCheckResult {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return { ok: true };
  try {
    const context = readTrustedContextNode(request);
    const raw = request.headers.get("origin");
    if (!raw) throw new Error("Missing origin");
    const origin = new URL(raw);
    if (origin.origin !== raw || origin.username || origin.password) throw new Error("Invalid origin");
    const origins = publicOrigins();
    const dev = localMode() && process.env.ALLOW_DEV_ORIGIN === "1";
    const allowed = surface === "admin" ? [origins[1], ...(dev ? [origins[0]] : [])] :
      surface === "staff" ? [origins[2], ...(dev ? [origins[0]] : [])] : [context.origin];
    if (!allowed.includes(raw) || !origins.includes(context.origin)) throw new Error("Wrong surface origin");
    return { ok: true };
  } catch { return { ok: false, response: NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: privateHeaders }) }; }
}
