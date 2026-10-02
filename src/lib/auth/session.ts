import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { StaffRole } from "@prisma/client";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Session management — custom, DB-backed, opaque-token sessions.
//
// Design (per 06-auth-and-roles.md):
//   • Cookie carries an opaque 256-bit random token (base64url). Only its
//     SHA-256 hash is stored in the `sessions` table — a DB leak yields no
//     usable cookies, and lookups hit the unique index on token_hash.
//   • httpOnly + SameSite=Lax cookie. Production sets Domain=.ROOT_DOMAIN
//     (leading dot, root-domain scope) per the spec's cookie-scope note; dev
//     on localhost uses host-only cookies (admin.localhost / staff.localhost
//     sessions stay separate in dev — the shared-domain cookie is a production
//     deployment convenience, not a trust statement between the panels).
//   • Short-lived: 12h absolute TTL ("hours-to-a-day range" per spec), with
//     sliding refresh when < 3h remain (applied by proxy.ts, which can set
//     cookies on every response it returns).
//   • Server-side revocation: logout deletes the row; soft-deactivation
//     (is_active = false) invalidates at validation time. User deletion
//     cascades to their sessions.
//
// This module is intentionally free of next/headers and next/navigation
// imports so it is safely importable from proxy.ts, route handlers, and
// server components alike.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_COOKIE_NAME = "sr_session";

/** 12 hours — spec: session lifetime in the hours-to-a-day range, never weeks. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Refresh the expiry when less than 3 hours remain ("short-lived and refreshed"). */
export const SESSION_REFRESH_THRESHOLD_MS = 3 * 60 * 60 * 1000;

/** The user fields safe to hand to application code (never the password hash). */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
};

export type ValidatedSession = {
  /** Raw cookie token (needed to re-set the cookie on session refresh). */
  token: string;
  session: { id: string; userId: string; expiresAt: Date };
  user: SessionUser;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve the cookie Domain attribute: `.silentrave.ng` in production, host-only on localhost. */
function sessionCookieDomain(): string | undefined {
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost").trim().toLowerCase();
  return rootDomain && rootDomain !== "localhost" ? `.${rootDomain}` : undefined;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    domain: sessionCookieDomain(),
    expires: expiresAt,
  };
}

// ── Core (no cookie access — callable from proxy, route handlers, RSC) ───────

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });

  // Opportunistic cleanup: purge expired sessions so the table stays small.
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return { token, expiresAt };
}

/**
 * Validate a raw session token against the DB.
 * Returns null for: unknown token, expired session, or a soft-deactivated
 * user (is_active = false invalidates all their sessions).
 */
export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (!session.user.isActive) return null;

  return {
    token,
    session: { id: session.id, userId: session.userId, expiresAt: session.expiresAt },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
    },
  };
}

/**
 * Sliding refresh: extend a session nearing expiry. Returns the new expiry
 * (caller should re-set the cookie with the same token), or null if the
 * session is not yet close enough to expiry to bother.
 */
export async function extendSessionIfNeeded(
  session: { id: string; expiresAt: Date }
): Promise<Date | null> {
  const remaining = session.expiresAt.getTime() - Date.now();
  if (remaining > SESSION_REFRESH_THRESHOLD_MS) return null;

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.update({ where: { id: session.id }, data: { expiresAt } });
  return expiresAt;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => undefined);
}

// ── Request wrapper (proxy.ts + route handlers) ──────────────────────────────

/** Reads the session cookie off a NextRequest and validates it against the DB. */
export async function getSessionUserFromRequest(
  request: NextRequest
): Promise<ValidatedSession | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSessionToken(token);
}
