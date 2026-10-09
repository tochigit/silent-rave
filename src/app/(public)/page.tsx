import Link from "next/link";
import { EventList } from "@/components/customer/event-list";
import { listEvents, catalogQuery } from "@/lib/events/catalog";
import { lagosDay } from "@/lib/customer/format";
export const dynamic = "force-dynamic";
export default async function Home() {
  const listing = await listEvents(
    catalogQuery.parse({ filter: "upcoming" }),
  ).catch(() => null);
  const today = lagosDay(new Date());
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
        <section className="stack">
          <div className="catalog-toolbar">
            <form action="/events" className="catalog-search">
              <input type="hidden" name="filter" value="upcoming" />
              <label><span className="sr-only">Search events</span><input name="search" type="search" maxLength={100} placeholder="Search for events" /></label>
              <button type="submit">Find events</button>
            </form>
            <nav className="view-links" aria-label="Event views">
              <Link href="/events?filter=upcoming&view=list" aria-current="page">List</Link>
              <Link href={`/events?view=month&date=${today.slice(0, 7)}`}>Month</Link>
              <Link href={`/events?view=day&date=${today}`}>Day</Link>
            </nav>
          </div>
          <div className="section-heading catalog-heading"><h1>Upcoming events</h1><Link href="/events">All events <span aria-hidden="true">↗</span></Link></div>
          <p className="muted">Find your next night. All event times are in WAT.</p>
          <EventList events={listing.events} />
        </section>
      )}
    </>
  );
}
