import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fakeVerify, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth/session";
import {
  consumeRateLimit,
  RateLimitUnavailableError,
  rateLimitUnavailableResponse,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { originCheck } from "@/lib/auth/origin";
import { surfaceUrl } from "@/lib/auth/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — shared login endpoint for both OWNER and STAFF
// (single staff_users table per 02-database-schema.md).
//
// Decision (per build instruction): ONE endpoint, not per-subdomain. The
// credentials are verified first; the role is then looked up server-side from
// the session user. The optional `intent` field ("admin" | "staff") is UX
// sugar from whichever login page was used — it lets us reject a STAFF
// account at the admin login page with a clear message. It is NOT a security
// boundary: authorization is enforced per-request by guardApi/requirePageRole
// regardless of how the session was obtained.
//
// Anti-enumeration: identical 401 "Invalid email or password" (same shape,
// same timing path via dummy bcrypt compare) for unknown email, wrong
// password, and deactivated account.
//
// Origin check (06, Task 0e): login is a state-changing POST (creates a
// session) and browsers always send Origin on cross-origin POSTs, so the
// same-origin property is enforceable here — NOT exempted. The "auth" surface
// accepts the root/admin/staff hosts of ROOT_DOMAIN (production) and, in dev,
// any request host as long as Origin matches it exactly (sandbox preview
// gateway — see src/lib/auth/origin.ts).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
  intent: z.enum(["admin", "staff"]).optional(),
});

function invalidCredentials(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Invalid email or password" },
    { status: 401 },
  );
}

export async function POST(request: NextRequest) {
  try {
    // Origin check first (Task 0e — login NOT exempted; see header comment).
    const origin = originCheck(request, "auth");
    if (!origin.ok) return origin.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Expected { email, password, intent? }" },
        { status: 400 },
      );
    }

    const email = parsed.data.email.trim().toLowerCase();
    const { password, intent } = parsed.data;

    // 10 attempts / 10 min / per email (shared configured backend — see lib/rate-limit.ts).
    const { limited, retryAfterSec } = await consumeRateLimit("login", email, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limited) {
      return rateLimitResponse(
        retryAfterSec,
        "Too many attempts — try again in a few minutes",
      );
    }

    const user = await db.staffUser.findUnique({ where: { email } });

    // Timing-equalized rejection for unknown emails.
    if (!user) {
      await fakeVerify(password);
      return invalidCredentials();
    }

    const passwordOk = await verifyPassword(password, user.passwordHash);
    if (!passwordOk || !user.isActive) {
      return invalidCredentials();
    }

    // Role/intent compatibility (UX layer only — real enforcement is per-request).
    if (intent === "admin" && user.role !== "OWNER") {
      return NextResponse.json(
        { ok: false, error: "This account does not have admin access" },
        { status: 403 },
      );
    }

    const { token, expiresAt } = await createSession(user.id);

    await db.staffUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const redirectTo = user.mustChangePassword
      ? surfaceUrl("staff", "/staff/password")
      : intent === "staff"
        ? surfaceUrl("staff", "/staff")
        : intent === "admin"
          ? surfaceUrl("admin", "/admin")
          : user.role === "OWNER"
            ? surfaceUrl("admin", "/admin")
            : surfaceUrl("staff", "/staff");

    const response = NextResponse.json(
      { ok: true, role: user.role, redirectTo },
      { status: 200 },
    );
    response.cookies.set(
      SESSION_COOKIE_NAME,
      token,
      sessionCookieOptions(expiresAt),
    );
    return response;
  } catch (error) {
    if (error instanceof RateLimitUnavailableError)
      return rateLimitUnavailableResponse();
    throw error;
  }
}
