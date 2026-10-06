import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { expireHolds } from "@/lib/orders/expiry";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/internal/expire-holds (03 "Internal / background jobs" v2.1).
//
// Hold-expiry sweep, guarded by CRON_SECRET in the x-cron-secret header
// (constant-time compare, fail-closed 401). One transaction,
// FOR UPDATE SKIP LOCKED, EXPIRED + inventory_released + reserved decrements.
// Idempotent — re-running finds no candidates.
//
// No Origin check and no session guard: this is a machine-to-machine route
// with its own bearer secret — there is no ambient cookie credential, so
// CSRF/Origin do not apply (06 scopes those checks to admin/staff routes).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[internal/expire-holds] CRON_SECRET is not configured — refusing.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }

  const presented = request.headers.get("x-cron-secret") ?? "";
  const expected = Buffer.from(secret, "utf8");
  const given = Buffer.from(presented, "utf8");
  const ok = expected.length === given.length && expected.length > 0 && timingSafeEqual(expected, given);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const result = await expireHolds();
    return NextResponse.json({ expired: result.expired }, { status: 200 });
  } catch (error) {
    console.error("[internal/expire-holds] sweep failed");
    return NextResponse.json({ error: "Sweep failed." }, { status: 500 });
  }
}
