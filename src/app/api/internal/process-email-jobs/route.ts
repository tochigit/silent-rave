import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { processEmailJobs } from "@/lib/email/worker";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET; const given = request.headers.get("x-cron-secret");
  if (!expected || !given || !timingSafeEqual(createHash("sha256").update(expected).digest(), createHash("sha256").update(given).digest())) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try { return NextResponse.json(await processEmailJobs()); }
  catch { return NextResponse.json({ error: "Email worker unavailable." }, { status: 503 }); }
}
