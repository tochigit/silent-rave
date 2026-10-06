import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { StaffRole } from "@prisma/client";
import { db } from "@/lib/db";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./policy";
export { SESSION_COOKIE_NAME, SESSION_TTL_MS, SESSION_REFRESH_THRESHOLD_MS, sessionCookieOptions } from "./policy";
export type SessionUser = { id: string; name: string; email: string; role: StaffRole; mustChangePassword: boolean };
export type ValidatedSession = { token: string; session: { id: string; userId: string; expiresAt: Date }; user: SessionUser };
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const rows = await db.$queryRaw<{ expiresAt: Date }[]>`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}::uuid, ${hashToken(token)}, clock_timestamp() + interval '12 hours')
    RETURNING expires_at AS "expiresAt"`;
  await db.$executeRaw`DELETE FROM sessions WHERE expires_at <= clock_timestamp()`;
  return { token, expiresAt: rows[0].expiresAt };
}
export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await db.$queryRaw<{ id: string; userId: string; expiresAt: Date; name: string; email: string; role: StaffRole; mustChangePassword: boolean }[]>`
    SELECT s.id, s.user_id AS "userId", s.expires_at AS "expiresAt", u.name, u.email, u.role,
           u.must_change_password AS "mustChangePassword"
    FROM sessions s JOIN staff_users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > clock_timestamp() AND u.is_active`;
  if (!rows.length) return null;
  const row = rows[0];
  return { token, session: { id: row.id, userId: row.userId, expiresAt: row.expiresAt },
    user: { id: row.userId, name: row.name, email: row.email, role: row.role, mustChangePassword: row.mustChangePassword } };
}
export async function extendSessionIfNeeded(session: { id: string; userId: string; expiresAt: Date }): Promise<Date | null> {
  // Match password/deactivation writers' user -> session lock order. Database
  // time is evaluated AFTER obtaining both locks, including lock-wait expiry.
  return db.$transaction(async tx => {
    const users = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM staff_users WHERE id = ${session.userId}::uuid AND is_active FOR SHARE`;
    if (!users.length) return null;
    await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${session.id}::uuid AND user_id = ${session.userId}::uuid FOR UPDATE`;
    const rows = await tx.$queryRaw<{ expiresAt: Date }[]>`
      UPDATE sessions SET expires_at = GREATEST(expires_at, clock_timestamp() + interval '12 hours')
      WHERE id = ${session.id}::uuid AND user_id = ${session.userId}::uuid
        AND expires_at > clock_timestamp() AND expires_at <= clock_timestamp() + interval '3 hours'
      RETURNING expires_at AS "expiresAt"`;
    return rows[0]?.expiresAt ?? null;
  }, { timeout: 10_000, maxWait: 5000 });
}
export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}
export async function getSessionUserFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return token ? validateSessionToken(token) : null;
}
