import { type NextRequest, NextResponse } from "next/server";
import { catalogQuery, listEvents } from "@/lib/events/catalog";
export async function GET(request: NextRequest) {
  const parsed = catalogQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid event filters." },
      { status: 400 },
    );
  try {
    return NextResponse.json(await listEvents(parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_DATE")
      return NextResponse.json(
        { error: "Use a valid Lagos calendar date." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Events are temporarily unavailable." },
      { status: 503 },
    );
  }
}
