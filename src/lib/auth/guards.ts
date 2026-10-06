import { NextResponse, type NextRequest } from "next/server";
import type { StaffRole } from "@prisma/client";
import { getSessionUserFromRequest } from "./session";
import { readTrustedContextNode } from "@/lib/hosting/request-context-node";
import { privateHeaders } from "./policy";

// ─────────────────────────────────────────────────────────────────────────────
// API route guard (06-auth-and-roles.md — "Every API endpoint that touches
// admin or staff functionality checks the authenticated user's role on the
// server, on every request"):
//
//   • 401 for no/invalid session, 403 for a valid session with the wrong role.
//   • Role matrix (spec 03/06):
//       /api/admin/*  → OWNER only              (ADMIN_API_ROLES)
//       /api/staff/*  → STAFF or OWNER          (STAFF_API_ROLES)
//
// proxy.ts ALSO enforces this centrally for every /api/admin/* and /api/staff/*
// request (defense in depth — a forgotten guard in a future route still cannot
// leak data), but calling guardApi at the top of each route handler remains
// the spec-mandated enforcement point.
//
// Usage:
//   const guard = await guardApi(request, ADMIN_API_ROLES);
//   if (!guard.ok) return guard.response;
//   // ...guard.user is the authenticated StaffUser
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_API_ROLES: StaffRole[] = ["OWNER"];
export const STAFF_API_ROLES: StaffRole[] = ["STAFF", "OWNER"];

export type ApiGuardResult =
  | { ok: true; user: { id: string; name: string; email: string; role: StaffRole } }
  | { ok: false; response: NextResponse };

export async function guardApi(
  request: NextRequest,
  allowed: StaffRole[]
): Promise<ApiGuardResult> {
  try { readTrustedContextNode(request); }
  catch { return { ok: false, response: NextResponse.json({ error: "Untrusted request context" }, { status: 421, headers: privateHeaders }) }; }
  let validated;
  try { validated = await getSessionUserFromRequest(request); }
  catch { return { ok: false, response: NextResponse.json({ error: "Authentication service unavailable" }, { status: 503, headers: privateHeaders }) }; }
  if (!validated) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401, headers: privateHeaders }),
    };
  }
  if (!allowed.includes(validated.user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: privateHeaders }),
    };
  }
  if (validated.user.mustChangePassword) return { ok: false, response: NextResponse.json({ error: "Change your temporary password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403, headers: privateHeaders }) };
  return { ok: true, user: validated.user };
}
