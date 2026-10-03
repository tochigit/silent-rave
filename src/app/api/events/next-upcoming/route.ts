import { NextResponse } from "next/server";
import { nextUpcoming } from "@/lib/events/catalog";
export async function GET() {
  try {
    return NextResponse.json(await nextUpcoming(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Events are temporarily unavailable." },
      { status: 503 },
    );
  }
}
