import Link from "next/link";
import type { CatalogEvent } from "@/lib/customer/types";
import { lagosDate, money } from "@/lib/customer/format";
export function EventCard({ event }: { event: CatalogEvent }) {
  const date = event.starts_at ? new Date(event.starts_at) : null;
  const format = (options: Intl.DateTimeFormatOptions) => date ? new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Lagos", ...options }).format(date) : "";
  return (
    <article className="event-card">
      <div className="event-date-badge" aria-hidden="true"><span>{date ? format({ weekday: "short" }) : "DATE"}</span><strong>{date ? format({ day: "numeric" }) : "TBA"}</strong></div>
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
        <p className="event-list-datetime">
          {event.starts_at ? lagosDate(event.starts_at) + " · WAT" : "Date to be announced"}
        </p>
        <h2>
          <Link href={`/event/${encodeURIComponent(event.slug)}`}>
            {event.title}
          </Link>
        </h2>
        <p>{event.venue.name}</p><p className="muted">{event.venue.city}</p>
        <div className="row">
          <Link className="event-ticket-link" href={`/event/${encodeURIComponent(event.slug)}#tickets`}>{!event.is_date_confirmed ? "Coming soon" : event.sold_out ? "View event" : "Get tickets"}</Link>
          <span>
            {event.price_range
              ? `${money(event.price_range.min_kobo)}${event.price_range.max_kobo !== event.price_range.min_kobo ? ` – ${money(event.price_range.max_kobo)}` : ""}`
              : "Tiers coming soon"}
          </span>
          {event.sold_out && <span className="pill">Sold out</span>}
        </div>
      </div>
    </article>
  );
}
