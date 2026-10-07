import Link from "next/link";
import { EventDetailPage } from "@/components/customer/event-detail";
import { EventCard } from "@/components/customer/event-card";
import { listEvents, catalogQuery } from "@/lib/events/catalog";
export const dynamic = "force-dynamic";
export default async function Home() {
  const listing = await listEvents(
    catalogQuery.parse({ filter: "upcoming" }),
  ).catch(() => null);
  return (
    <>
      {listing === null ? (
        <section className="panel stack" role="alert">
          <h1>Silent Rave</h1>
          <p>Events are temporarily unavailable.</p>
          <Link href="/events">Try loading events</Link>
        </section>
      ) : !listing.events.length ? (
        <section className="panel empty stack">
          <h1>Silent Rave</h1>
          <h2>No upcoming events — check back soon</h2>
          <p>New events will appear here when they are published.</p>
          <Link className="button" href="/events">Explore events</Link>
        </section>
      ) : (
        <EventDetailPage slug={listing.events[0].slug} featured />
      )}
      {listing && listing.events.length > 1 && (
        <section className="stack">
          <h2>More upcoming events</h2>
          <div className="event-grid">
            {listing.events.slice(1, 3).map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        </section>
      )}
    </>
  );
}
