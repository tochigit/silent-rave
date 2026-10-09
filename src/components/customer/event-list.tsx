import { EventCard } from "./event-card";
import type { CatalogEvent } from "@/lib/customer/types";

/** Month headings and date badges use the same Lagos timezone as checkout. */
export function EventList({ events }: { events: CatalogEvent[] }) {
  const groups = new Map<string, CatalogEvent[]>();
  for (const event of events) {
    const month = event.starts_at ? new Intl.DateTimeFormat("en-NG", {
      month: "long", year: "numeric", timeZone: "Africa/Lagos",
    }).format(new Date(event.starts_at)) : "Date to be announced";
    groups.set(month, [...(groups.get(month) ?? []), event]);
  }
  return <div className="event-list">{[...groups].map(([month, items]) =>
    <section className="event-month" key={month}>
      <h2 className="month-heading">{month}</h2>
      <div className="event-grid">{items.map(event => <EventCard key={event.id} event={event} />)}</div>
    </section>,
  )}</div>;
}
