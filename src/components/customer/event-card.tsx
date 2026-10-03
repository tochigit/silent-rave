import Link from "next/link";
import type { CatalogEvent } from "@/lib/customer/types";
import { lagosDate, money } from "@/lib/customer/format";
export function EventCard({ event }: { event: CatalogEvent }) {
  return (
    <article className="event-card">
      <Link
        href={`/event/${encodeURIComponent(event.slug)}`}
        className="poster-link"
      >
        {event.banner_image_url ? (
          <img
            className="poster"
            src={event.banner_image_url}
            alt={`${event.title} poster`}
            width={600}
            height={900}
            loading="lazy"
          />
        ) : (
          <div className="poster-placeholder">
            <span>
              SILENT
              <br />
              RAVE
            </span>
            <small>Poster coming soon</small>
          </div>
        )}
      </Link>
      <div className="event-card-copy">
        <p className="eyebrow">{event.venue.city}</p>
        <h2>
          <Link href={`/event/${encodeURIComponent(event.slug)}`}>
            {event.title}
          </Link>
        </h2>
        <p>
          {event.starts_at
            ? lagosDate(event.starts_at) + " · WAT"
            : "Date to be announced"}
        </p>
        <p className="muted">{event.venue.name}</p>
        <div className="row">
          <span>
            {event.price_range
              ? `From ${money(event.price_range.min_kobo)}`
              : "Tiers coming soon"}
          </span>
          <span className="pill">
            {!event.is_date_confirmed
              ? "Coming soon"
              : event.sold_out
                ? "Sold out"
                : "View tickets"}
          </span>
        </div>
      </div>
    </article>
  );
}
