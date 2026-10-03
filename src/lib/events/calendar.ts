export const CALENDAR_FORMATS = [
  "google",
  "ical",
  "outlook365",
  "outlooklive",
  "ics",
] as const;
export type CalendarFormat = (typeof CALENDAR_FORMATS)[number];
export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  location: string;
  createdAt: Date;
};
const utc = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const escape = (text: string) =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n|\r/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
// RFC 5545 lines are folded at 75 octets, without splitting UTF-8 glyphs.
function fold(line: string) {
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  return [...lines, current].join("\r\n");
}
/** All formats consume this one event representation; timestamps are actual UTC instants. */
export function calendarOutput(
  event: CalendarEvent,
  format: CalendarFormat,
): { ics: string; redirect?: string } {
  const ics =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Silent Rave//Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${event.id}@silent-rave`,
      `DTSTAMP:${utc(event.createdAt)}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${escape(event.title)}`,
      `DESCRIPTION:${escape(event.description)}`,
      `LOCATION:${escape(event.location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n";
  if (format === "google")
    return {
      ics,
      redirect:
        "https://calendar.google.com/calendar/render?" +
        new URLSearchParams({
          action: "TEMPLATE",
          text: event.title,
          dates: `${utc(event.startsAt)}/${utc(event.endsAt)}`,
          details: event.description,
          location: event.location,
          ctz: "Africa/Lagos",
        }),
    };
  if (format === "outlook365" || format === "outlooklive")
    return {
      ics,
      redirect:
        `https://${format === "outlook365" ? "outlook.office.com" : "outlook.live.com"}/calendar/0/deeplink/compose?` +
        new URLSearchParams({
          path: "/calendar/action/compose",
          rru: "addevent",
          subject: event.title,
          body: event.description,
          location: event.location,
          startdt: event.startsAt.toISOString(),
          enddt: event.endsAt.toISOString(),
        }),
    };
  return { ics };
}
