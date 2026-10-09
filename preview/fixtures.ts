import type { EventDetail } from "../src/lib/customer/types";

// Entirely illustrative content. No hosted data or credentials are read.
export const previewEvents: EventDetail[] = [{
  id: "preview-evangel", slug: "nusa-evangel-silent-rave", title: "NUSA Evangel - Silent Rave",
  banner_image_url: "/assets/poster.jpeg",
  starts_at: "2026-11-11T16:00:00+01:00", ends_at: "2026-11-11T21:00:00+01:00",
  is_date_confirmed: true, sold_out: false, status: "PUBLISHED",
  price_range: { min_kobo: 50000, max_kobo: 200000 },
  description: "Silent Rave is coming to Evangel University. Bring your friends, slip on a pair of headphones and choose your favourite sound.\n\nAn evening of music, dancing and good company, with multiple channels so you can find your own frequency.\n\nChoose your ticket below and get ready for the experience. This event information is sample content for design review.",
  venue: { name: "Evangel University Akaeze", city: "Akaeze", address: "KM 48, Enugu-Abakaliki Expressway, Okpoto\nEbonyi State, Nigeria", latitude: null, longitude: null, directions_url: null, map_embed_url: null },
  organizer: { name: "Intelligent Minds", description: null },
  ticket_tiers: [
    { id: "preview-early", name: "Early Bird Ticket", price_kobo: 50000, available: 30, state: "OPEN", sales_start_at: null, sales_end_at: null },
    { id: "preview-standard", name: "Standard Ticket", price_kobo: 200000, available: 50, state: "OPEN", sales_start_at: null, sales_end_at: null },
  ],
  calendar_links: {
    google: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=NUSA+Silent+Rave&dates=20261111T150000Z/20261111T200000Z&location=Evangel+University+Akaeze",
    ical: "data:text/calendar;charset=utf-8," + encodeURIComponent("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:silent-rave-preview@example.invalid\r\nDTSTAMP:20261007T000000Z\r\nSUMMARY:NUSA Silent Rave\r\nDTSTART:20261111T150000Z\r\nDTEND:20261111T200000Z\r\nLOCATION:Evangel University Akaeze\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"),
    outlook365: "https://outlook.office.com/calendar/0/deeplink/compose?subject=NUSA+Silent+Rave&startdt=2026-11-11T15:00:00Z&enddt=2026-11-11T20:00:00Z",
    outlooklive: "https://outlook.live.com/calendar/0/deeplink/compose?subject=NUSA+Silent+Rave&startdt=2026-11-11T15:00:00Z&enddt=2026-11-11T20:00:00Z",
  },
}];

export const previewPages = {
  about: { title: "About Silent Rave", body: "Music, energy and a night with your people.\n\nSilent Rave brings people together through music, movement and a shared night out. Slip on a pair of headphones, choose a channel and make the dance floor your own.\n\nBring your friends, find your favourite sound and make memories together.\n\nSample copy for design review. Final event and brand information will be supplied before launch." },
  contact: { title: "Contact", body: "Have a question about Silent Rave, an event or your tickets? Get in touch using the form below.\n\nThis is a design preview. Contact details are illustrative and the message form is disabled." },
};

export function installPreviewData() {
  // All component reads resolve in memory. Unknown requests never reach a server.
  // The repository's Bun ambient types add fetch.preconnect; browsers do not.
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(request?.url ?? String(input), window.location.origin);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let value: unknown = { error: "This action is disabled in the design preview." };
    let status = 403;
    if (url.origin === window.location.origin && method === "GET") {
      if (url.pathname === "/api/events/next-upcoming") {
        value = { result: "single", event: previewEvents[0] }; status = 200;
      } else if (url.pathname === "/api/events") {
        const q = url.searchParams;
        const search = (q.get("search") ?? "").trim().toLowerCase();
        const city = (q.get("city") ?? "").trim().toLowerCase();
        const date = q.get("date");
        const events = previewEvents.filter(event => {
          if (search && !`${event.title} ${event.venue.name}`.toLowerCase().includes(search)) return false;
          if (city && !event.venue.city.toLowerCase().includes(city)) return false;
          if (date && event.starts_at) {
            const day = event.starts_at.slice(0, 10);
            if (q.get("view") === "month" ? !day.startsWith(date.slice(0, 7)) : day !== date) return false;
          }
          return true;
        });
        value = { events, pagination: { page: 1, total_pages: 1, total_events: events.length } }; status = 200;
      } else if (url.pathname.startsWith("/api/events/")) {
        const event = previewEvents.find(event => url.pathname === `/api/events/${event.slug}`);
        value = event ?? { error: "Event not found" }; status = event ? 200 : 404;
      }
    }
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  }) as typeof window.fetch;
}
