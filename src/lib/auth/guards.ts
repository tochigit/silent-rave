import { NextResponse, type NextRequest } from "next/server";
import type { StaffRole } from "@prisma/client";
import { getSessionUserFromRequest } from "./session";
import { db } from "@/lib/db";

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
  const validated = await getSessionUserFromRequest(request);
  if (!validated) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }
  if (!allowed.includes(validated.user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  const account = await db.staffUser.findUnique({ where: { id: validated.user.id }, select: { mustChangePassword: true } });
  if (account?.mustChangePassword) return { ok: false, response: NextResponse.json({ error: "Change your temporary password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" }, { status: 403 }) };
  return { ok: true, user: validated.user };
}
