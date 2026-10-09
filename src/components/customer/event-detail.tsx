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
export function EventDetailPage({ slug, featured = false }: { slug: string; featured?: boolean }) {
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTier || !dialog.current) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedTier]);
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
      <div className={error ? "panel" : "panel loading-panel"} role={error ? "alert" : "status"} aria-busy={!error}>
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
    setSelectedTier(null);
    setNotice("Tickets added to your cart. Continue to checkout.");
  }
  const selected = event.ticket_tiers.find((tier) => tier.id === selectedTier);
  const day = (date: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(date));
  const time = (date: string) => new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(date)).toLowerCase();
  const dateLabel = event.starts_at
    ? `${day(event.starts_at)} @ ${time(event.starts_at)}${event.ends_at ? ` – ${day(event.ends_at) === day(event.starts_at) ? "" : day(event.ends_at) + " @ "}${time(event.ends_at)}` : ""} · WAT`
    : "Date to be announced";
  return (
    <section className="reference-event">
      <div className="alert-banner">
        {event.status === "CANCELLED" ? "This event has been cancelled. Ticket sales are closed."
          : featured ? "Upcoming event"
          : <Link href="/events">← All events</Link>}
      </div>
      {error && <div role="alert" className="panel"><p>{error}</p><button onClick={refresh}>Refresh availability</button></div>}
      <header className="event-header">
        <h1 className="event-title">{event.title}</h1>
        <p className="event-datetime-sub">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
          <span>{dateLabel}</span>
        </p>
        {event.price_range && <p className="event-price-range">{money(event.price_range.min_kobo)}{event.price_range.max_kobo !== event.price_range.min_kobo ? ` – ${money(event.price_range.max_kobo)}` : ""}</p>}
      </header>
      <div className="event-hero-grid">
        <div className="poster-container">
          {event.banner_image_url ? <img className="detail-poster" src={event.banner_image_url} alt={`${event.title} poster`} width={600} height={900} />
            : <div className="poster-placeholder"><span>SILENT<br />RAVE</span><small>Poster coming soon</small></div>}
        </div>
        <div className="event-content">
          <div className="event-description">{event.description}</div>
          {Object.keys(event.calendar_links).length > 0 && <details className="calendar-dropdown">
            <summary className="calendar-btn">Add to calendar <span aria-hidden="true">▾</span></summary>
            <div className="calendar-menu">
              {Object.entries(event.calendar_links).map(([format, url]) => <a key={format} href={url} download={format === "ical" || format === "ics" ? "event.ics" : undefined} target={format === "ical" || format === "ics" ? undefined : "_blank"} rel="noreferrer">
                {({ google: "Google Calendar", ical: "iCalendar", outlook365: "Outlook 365", outlooklive: "Outlook Live", ics: "Download .ics" } as Record<string, string>)[format] ?? format}
              </a>)}
            </div>
          </details>}
          <div id="tickets" className="tickets-section" tabIndex={-1}>
            <h2 className="tickets-title">Tickets</h2>
            <p className="tickets-status">Choose your ticket. Up to 10 tickets per order.</p>
            {!event.ticket_tiers.length && <p>Ticket tiers coming soon.</p>}
            <div className="ticket-options">
              {event.ticket_tiers.map((tier) => <div className="ticket-card" key={tier.id}>
                <div><strong>{tier.name}</strong><p className="subtext">
                  {states[tier.state]}{tier.state === "OPEN" ? ` · ${tier.available} left` : ""}
                  {tier.state === "COMING_SOON" && tier.sales_start_at ? ` · ${lagosDate(tier.sales_start_at)} WAT` : ""}
                  {(quantities[tier.id] ?? 0) > 0 ? ` · ${quantities[tier.id]} selected` : ""}
                </p></div>
                <div className="ticket-action"><span className="ticket-price">{money(tier.price_kobo)}</span><button className="buy-btn" aria-label={`Buy ${tier.name}`} disabled={tier.state !== "OPEN" || tier.available < 1 || (!quantities[tier.id] && totalQuantity >= 10)} onClick={() => {
                  setQuantities((current) => ({ ...current, [tier.id]: current[tier.id] || 1 }));
                  setSelectedTier(tier.id);
                }}><span className="ticket-buy-label">{tier.state === "SOLD_OUT" ? "Sold out" : "Select tickets"} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></button></div>
              </div>)}
            </div>
            {notice && <div role="status" className="selection-notice"><p>{notice}</p><Link className="button purple" href="/checkout">Continue to checkout</Link></div>}
          </div>
        </div>
      </div>
      <div className="event-info-grid">
        <div className="details-grid">
          <div className="details-group"><h2>Details</h2><p><strong>Date:</strong> {event.starts_at ? day(event.starts_at) : "To be announced"}</p><p><strong>Time:</strong> {event.starts_at ? time(event.starts_at) : "To be announced"}{event.ends_at ? ` – ${time(event.ends_at)}` : ""} · WAT</p></div>
          <div className="details-group"><h2>Organizer</h2><p>{event.organizer.name}</p>{event.organizer.description && <p className="prose">{event.organizer.description}</p>}</div>
        </div>
        <div className="details-group venue-group"><h2>Venue</h2><p>{event.venue.name}</p><p className="prose">{event.venue.address}</p>
          {event.venue.directions_url && <a className="secondary" href={event.venue.directions_url} target="_blank" rel="noreferrer">Get directions</a>}
          {event.venue.map_embed_url ? <div className="map-box"><iframe src={event.venue.map_embed_url} title={`Map of ${event.venue.name}`} loading="lazy" referrerPolicy="no-referrer" /></div>
            : <div className="map-box map-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><strong>{event.venue.name}</strong><span>Venue location · Map unavailable</span></div>}
        </div>
      </div>
      <dialog ref={dialog} className="ticket-modal" aria-labelledby="ticket-dialog-title" onCancel={() => setSelectedTier(null)} onClick={(click) => { if (click.target === click.currentTarget) setSelectedTier(null); }}>
        {selected && <div className="modal-content">
          <button className="close-btn" aria-label="Close ticket selection" onClick={() => setSelectedTier(null)}>×</button>
          <h2 id="ticket-dialog-title">Buy {selected.name}</h2>
          <p className="subtext">{money(selected.price_kobo)} per ticket</p>
          <div className="stack">
            <p>Quantity (number of tickets)</p>
            <div className="quantity">
              <button aria-label={`Remove one ${selected.name}`} disabled={!quantities[selected.id]} onClick={() => setQuantities((current) => ({ ...current, [selected.id]: Math.max(0, (current[selected.id] ?? 0) - 1) }))}>−</button>
              <output aria-label={`${selected.name} quantity`}>{quantities[selected.id] ?? 0}</output>
              <button aria-label={`Add one ${selected.name}`} disabled={selected.state !== "OPEN" || (quantities[selected.id] ?? 0) >= selected.available || totalQuantity >= 10} onClick={() => setQuantities((current) => ({ ...current, [selected.id]: (current[selected.id] ?? 0) + 1 }))}>+</button>
            </div>
          </div>
          {(quantities[selected.id] ?? 0) > 0 && <details className="names"><summary>Optional holder names · {selected.name}</summary>
            {Array.from({ length: quantities[selected.id] }, (_, index) => <label key={index}>Ticket {index + 1} holder<input maxLength={200} value={names[selected.id]?.[index] ?? ""} placeholder="Leave blank to use buyer name" onChange={(change) => setNames((current) => { const values = [...(current[selected.id] ?? [])]; values[index] = change.target.value; return { ...current, [selected.id]: values }; })} /></label>)}
          </details>}
          <p className="total">Total amount <strong>{money(total)}</strong></p>
          {cart && cart.eventId !== event.id && <p className="subtext">These tickets replace the other event in your cart.</p>}
          {!valid && <p role="alert" className="error">Availability changed. Reduce quantities or choose another tier.</p>}
          <button className="button" disabled={!totalQuantity || !valid} onClick={add}>Add {totalQuantity || ""} {totalQuantity === 1 ? "ticket" : "tickets"} to cart</button>
          <p className="subtext">Enter your details at checkout, then receive bank transfer instructions. Only approved payments create tickets.</p>
        </div>}
      </dialog>
    </section>
  );
}
