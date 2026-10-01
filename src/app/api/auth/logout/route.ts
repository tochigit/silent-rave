import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  destroySession,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { originCheck } from "@/lib/auth/origin";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout — server-side session revocation: deletes the session
// row from the DB and clears the cookie. Always 200 (idempotent — logging out
// twice, or with no session, is not an error).
//
// Origin check (06, Task 0e): logout is a state-changing POST (deletes the
// session) — checked on the "auth" surface like login.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = originCheck(request, "auth");
  if (!origin.ok) return origin.response;

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await destroySession(token);
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  // Same name/domain/path/options as the login cookie, but already expired —
  // this is what actually removes it from the browser.
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(new Date(0)));
  return response;
}
