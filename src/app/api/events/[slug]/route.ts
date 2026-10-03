import { NextResponse } from "next/server";
import { publicEvent } from "@/lib/events/catalog";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const event = await publicEvent((await params).slug);
    return NextResponse.json(event ?? { error: "Event not found." }, {
      status: event ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Event is temporarily unavailable." },
      { status: 503 },
    );
  }
}
