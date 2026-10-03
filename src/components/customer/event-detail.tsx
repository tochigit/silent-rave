"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePoll } from "./use-poll";
import { useCart } from "./cart";
import { money, lagosDate } from "@/lib/customer/format";
import type { EventDetail, SaleState } from "@/lib/customer/types";
const states: Record<SaleState, string> = {
  OPEN: "Available",
  UNCONFIRMED: "Coming soon — date to be announced",
  COMING_SOON: "Sales open soon",
  CLOSED: "Sales closed",
  SOLD_OUT: "Sold out",
  ENDED: "Event ended",
  CANCELLED: "Event cancelled",
};
export function EventDetailPage({ slug }: { slug: string }) {
  const {
    data: event,
    error,
    notFound,
    refresh,
  } = usePoll<EventDetail>(`/api/events/${encodeURIComponent(slug)}`, {
    interval: 10000,
  });
  const { cart, save } = useCart();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState("");
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!cart || cart.slug !== slug || restored.current === slug) return;
    restored.current = slug;
    queueMicrotask(() => {
      setQuantities(
        Object.fromEntries(cart.lines.map((l) => [l.tierId, l.quantity])),
      );
      setNames(
        Object.fromEntries(cart.lines.map((l) => [l.tierId, l.holderNames])),
      );
    });
  }, [cart, slug]);
  useEffect(() => {
    if (!event || window.location.hash !== "#tickets") return;
    const tickets = document.getElementById("tickets");
    tickets?.scrollIntoView();
    tickets?.focus({ preventScroll: true });
  }, [event?.id]);
  if (notFound)
    return (
      <div className="panel">
        <h1>Event not found</h1>
        <p>This event is not publicly available.</p>
        <Link href="/events">Explore published events</Link>
      </div>
    );
  if (!event)
    return (
      <div className="panel" role={error ? "alert" : "status"}>
        {error || "Loading event…"}
        {error && <button onClick={refresh}>Retry</button>}
      </div>
    );
  const totalQuantity = Object.values(quantities).reduce((n, q) => n + q, 0);
  const total = event.ticket_tiers.reduce(
    (n, t) => n + (quantities[t.id] ?? 0) * t.price_kobo,
    0,
  );
  const valid = event.ticket_tiers.every(
    (t) =>
      !(quantities[t.id] ?? 0) ||
      (t.state === "OPEN" && t.available >= quantities[t.id]),
  );
  function add() {
    if (!event || !valid || !totalQuantity) return;
    save({
      eventId: event.id,
      slug: event.slug,
      title: event.title,
      lines: event.ticket_tiers
        .filter((t) => quantities[t.id])
        .map((t) => ({
          tierId: t.id,
          name: t.name,
          quantity: quantities[t.id],
          priceKobo: t.price_kobo,
          holderNames: names[t.id] ?? [],
        })),
    });
    setNotice("Tickets added to your cart. Continue to checkout.");
  }
  return (
    <section className="stack">
      <Link href="/events">← All events</Link>
      {error && (
        <div role="alert" className="panel">
          <p>{error}</p>
          <button onClick={refresh}>Refresh availability</button>
        </div>
      )}
      <div className="detail-grid">
        <div>
          {event.banner_image_url ? (
            <img
              className="detail-poster"
              src={event.banner_image_url}
              alt={`${event.title} poster`}
              width={600}
              height={900}
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
        </div>
        <div className="detail-copy">
          <div>
            <p className="eyebrow">{event.venue.city}</p>
            <h1>{event.title}</h1>
            <p>
              {event.starts_at
                ? `${lagosDate(event.starts_at)} – ${lagosDate(event.ends_at!)} · WAT`
                : "Date to be announced"}
            </p>
            {event.status === "CANCELLED" && (
              <p className="error">
                This event has been cancelled. Ticket sales are closed.
              </p>
            )}
          </div>
          <div className="prose">{event.description}</div>
          {Object.keys(event.calendar_links).length > 0 && (
            <details>
              <summary>Add to calendar</summary>
              <div className="calendar-menu">
                {Object.entries(event.calendar_links).map(([format, url]) => (
                  <a key={format} href={url} rel="noreferrer">
                    {
                      (
                        {
                          google: "Google Calendar",
                          ical: "iCalendar",
                          outlook365: "Outlook 365",
                          outlooklive: "Outlook Live",
                          ics: "Download .ics",
                        } as Record<string, string>
                      )[format]
                    }
                  </a>
                ))}
              </div>
            </details>
          )}
          <div>
            <h2>Venue</h2>
            <p>
              {event.venue.name}
              <br />
              {event.venue.address}
            </p>
            {event.venue.directions_url && (
              <a
                className="secondary"
                href={event.venue.directions_url}
                target="_blank"
                rel="noreferrer"
              >
                Get directions
              </a>
            )}
            {event.venue.map_embed_url && (
              <iframe
                className="map-frame"
                src={event.venue.map_embed_url}
                title={`Map of ${event.venue.name}`}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
          <div>
            <h2>Organizer</h2>
            <p>{event.organizer.name}</p>
            {event.organizer.description && (
              <p className="prose muted">{event.organizer.description}</p>
            )}
          </div>
        </div>
      </div>
      <div id="tickets" className="panel stack" tabIndex={-1}>
        <div>
          <p className="eyebrow">MAKE IT A NIGHT</p>
          <h2>Tickets</h2>
          <p className="muted">
            Up to 10 tickets per order. Holder names are optional.
          </p>
        </div>
        {!event.ticket_tiers.length && <p>Ticket tiers coming soon.</p>}
        {event.ticket_tiers.map((t) => (
          <div className="ticket-row" key={t.id}>
            <div>
              <h3>
                {t.name} · {money(t.price_kobo)}
              </h3>
              <p className="muted">
                {states[t.state]}
                {t.state === "OPEN" ? ` · ${t.available} left` : ""}
                {t.state === "COMING_SOON" && t.sales_start_at
                  ? ` · ${lagosDate(t.sales_start_at)} WAT`
                  : ""}
              </p>
            </div>
            <div className="quantity">
              <button
                aria-label={`Remove one ${t.name}`}
                disabled={!quantities[t.id]}
                onClick={() =>
                  setQuantities((q) => ({
                    ...q,
                    [t.id]: Math.max(0, (q[t.id] ?? 0) - 1),
                  }))
                }
              >
                −
              </button>
              <output aria-label={`${t.name} quantity`}>
                {quantities[t.id] ?? 0}
              </output>
              <button
                aria-label={`Add one ${t.name}`}
                disabled={
                  t.state !== "OPEN" ||
                  (quantities[t.id] ?? 0) >= t.available ||
                  totalQuantity >= 10
                }
                onClick={() =>
                  setQuantities((q) => ({ ...q, [t.id]: (q[t.id] ?? 0) + 1 }))
                }
              >
                +
              </button>
            </div>
            {(quantities[t.id] ?? 0) > 0 && (
              <details className="names">
                <summary>Optional holder names · {t.name}</summary>
                {Array.from({ length: quantities[t.id] }, (_, i) => (
                  <label key={i}>
                    Ticket {i + 1} holder
                    <input
                      maxLength={200}
                      value={names[t.id]?.[i] ?? ""}
                      onChange={(e) =>
                        setNames((n) => {
                          const values = [...(n[t.id] ?? [])];
                          values[i] = e.target.value;
                          return { ...n, [t.id]: values };
                        })
                      }
                      placeholder="Leave blank to use buyer name"
                    />
                  </label>
                ))}
              </details>
            )}
          </div>
        ))}
        {cart && cart.eventId !== event.id && (
          <p className="muted">
            Adding these tickets replaces your current event selection. Orders
            contain tickets for one event.
          </p>
        )}
        <p className="total">
          Estimated total <strong>{money(total)}</strong>
        </p>
        {!valid && (
          <p role="alert" className="error">
            Availability changed. Reduce quantities or choose another tier.
          </p>
        )}
        <button disabled={!totalQuantity || !valid} onClick={add}>
          Add {totalQuantity || ""} tickets to cart
        </button>
        {notice && (
          <p role="status">
            {notice}{" "}
            <Link className="button purple" href="/checkout">
              Continue to checkout
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
