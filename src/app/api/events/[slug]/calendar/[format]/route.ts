import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  calendarOutput,
  CALENDAR_FORMATS,
  type CalendarFormat,
} from "@/lib/events/calendar";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; format: string }> },
) {
  const { slug, format } = await params;
  if (!CALENDAR_FORMATS.includes(format as CalendarFormat))
    return NextResponse.json(
      { error: "Unknown calendar format." },
      { status: 400 },
    );
  const event = await db.event.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      title: true,
      description: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      isDateConfirmed: true,
      venue: { select: { name: true, address: true } },
    },
  });
  if (!event)
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  if (!event.isDateConfirmed)
    return NextResponse.json(
      { message: "Date to be announced." },
      { headers: { "Cache-Control": "no-store" } },
    );
  const result = calendarOutput(
    { ...event, location: `${event.venue.name}, ${event.venue.address}` },
    format as CalendarFormat,
  );
  if (result.redirect)
    return NextResponse.redirect(result.redirect, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(result.ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="SilentRave-event.ics"',
      "Cache-Control": "no-store",
    },
  });
}
