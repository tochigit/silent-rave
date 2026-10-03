import Link from "next/link";
import { BuyTickets } from "@/components/customer/shell";
import { EventCard } from "@/components/customer/event-card";
import { listEvents, catalogQuery } from "@/lib/events/catalog";
export const dynamic = "force-dynamic";
export default async function Home() {
  const listing = await listEvents(
    catalogQuery.parse({ filter: "upcoming" }),
  ).catch(() => null);
  return (
    <>
      <section className="home-hero">
        <div>
          <p className="eyebrow">TUNE IN. STEP OUT.</p>
          <h1>
            Your night.
            <br />
            <span>Your frequency.</span>
          </h1>
          <p className="hero-copy">
            Find your next Silent Rave. Pick your tickets, bring your people,
            and make a night of it.
          </p>
          <div className="actions">
            <BuyTickets />
            <Link className="secondary" href="/events">
              Explore events
            </Link>
          </div>
          <p className="muted">
            Guest checkout · Bank transfer · Owner-confirmed tickets
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="frequency-ring" />
          <span>
            SILENT
            <br />
            RAVE
          </span>
          <small>CHOOSE YOUR FREQUENCY</small>
        </div>
      </section>
      <section className="stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ON THE RADAR</p>
            <h2>The next nights</h2>
          </div>
          <Link href="/events?filter=upcoming">See all upcoming events</Link>
        </div>
        {listing === null ? (
          <div className="panel" role="alert">
            <p>Events are temporarily unavailable.</p>
            <Link href="/events">Try loading events</Link>
          </div>
        ) : !listing.events.length ? (
          <div className="panel empty">
            <h3>No upcoming events — check back soon</h3>
            <p>New nights will appear here when they are published.</p>
          </div>
        ) : (
          <div className="event-grid">
            {listing.events.slice(0, 3).map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
      <section className="how-it-works">
        <div>
          <span className="eyebrow">01 / CHOOSE</span>
          <h3>Find your night</h3>
          <p>Pick your tickets and optional holder names.</p>
        </div>
        <div>
          <span className="eyebrow">02 / TRANSFER</span>
          <h3>Pay by bank transfer</h3>
          <p>Use your order code and upload your receipt.</p>
        </div>
        <div>
          <span className="eyebrow">03 / CONFIRMED</span>
          <h3>Your tickets, ready</h3>
          <p>
            The owner checks payment. Download approved tickets from your saved
            order link.
          </p>
        </div>
      </section>
    </>
  );
}
