import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { StaffRole } from "@prisma/client";
import { SESSION_COOKIE_NAME, validateSessionToken, type SessionUser } from "./session";

// ─────────────────────────────────────────────────────────────────────────────
// Server-component (RSC) session helpers — used by page layouts.
//
// requirePageRole implements the spec's server-side page enforcement
// (06-auth-and-roles.md): no valid session, or the role is not allowed →
// redirect to the group's login page BEFORE any page chrome renders.
// redirect() throws, so a returned user is always authorized.
//
// This module is only imported from server components (it relies on the
// next/headers request scope).
// ─────────────────────────────────────────────────────────────────────────────

/** Reads the session cookie via next/headers and validates it against the DB. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return (await validateSessionToken(token))?.user ?? null;
}

export async function requirePageRole(
  allowed: StaffRole[],
  loginPath: string
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !allowed.includes(user.role)) {
    redirect(loginPath);
  }
  return user;
}
