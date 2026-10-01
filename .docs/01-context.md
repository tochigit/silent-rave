# 01. Project Context

## What this is

Silent Rave is a **rebuild** of an existing nightlife/events ticketing website (reference: nitroexperience.ng — a Nigerian monthly party series brand). The client wants the same observable behavior and visual experience as the reference site, but we are **not cloning its implementation**. The original runs on WordPress + Slider Revolution + The Events Calendar + Event Tickets plugins. We are building fresh on a modern stack, matching behavior, not plumbing.

**Design priority: mobile-first.** The overwhelming majority of ticket buyers will be on phones, browsing Instagram/WhatsApp and clicking straight through to buy. Every screen — public site, checkout, and even the staff scanner — is designed and built mobile-first, with desktop as the enhancement, not the default.

Reference images of the original site's look and structure inform layout only — Silent Rave is its own brand name and identity built on top of the same functional pattern, not a visual clone.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (mobile-first responsive) |
| Backend | Next.js API routes (single full-stack app) — see Open Decisions |
| Database | Postgres (via Supabase or direct) |
| Payments | **Manual bank transfer with proof upload and owner approval** (decided with client; Paystack archived as a possible future adapter). See `04-manual-payment.md` |
| Email | Resend + React Email templates |
| Email queue | DB-backed job table (no Redis) |
| PDF generation | Per-ticket PDF with embedded QR (see `05-ticketing-and-qr.md`) |
| QR | Ed25519-signed tokens (phones hold only the public key, enabling safe offline verification) |
| Realtime | Server-emitted events (Supabase Realtime where available) plus mandatory polling fallback; never the source of truth |
| Notifications | Web Push (VAPID) to the owner when a payment proof arrives |
| Scanner | Offline-capable PWA on the staff subdomain |
| File storage | Supabase Storage or S3: public banners; **private** bucket for payment proofs and generated PDFs |

## Core principle: behavioral parity, not implementation parity

The original's plugin chain (Events Calendar → Tickets → Cart → Checkout → Payment) is replaced by our own Events/Venues/Organizers/Tickets/Orders schema on Postgres, our own cart/checkout flow, and manual bank-transfer approval for payment — but the *customer-facing experience* should feel equivalent or better.

## Site structure (module tree)

```
Silent Rave
├── 01. Global Shell — Header, Nav, Cart, Footer
├── 02. Homepage — Hero, upcoming event sections, CTAs
├── 03. Events — List / Month / Day views, Search, Filtering
├── 04. Event Detail — Hero, metadata, Venue, Map, Organizer, Add-to-calendar, Ticket tiers
├── 05. Ticketing — Tiers, Inventory, Quantity, Checkout (bank transfer + proof upload), Order status page
├── 06. Static Pages — About, Contact
├── 07. Admin (owner) — Events (incl. banner upload), Venues, Organizers,
│                        Ticket tiers, Inventory, Payment review queue, Orders, Bank account, Push, Reconciliation, Staff accounts, Audit log
├── 08. Staff (subdomain) — offline-capable QR scanner / check-in only, no financial data access
└── 09. Visual System — Typography, Colors, Spacing, Components, Responsive behavior, Animations (mobile-first)
```

## Key product decisions locked in

- **Payment is confirmed by the owner, not the browser.** The buyer uploads a receipt and taps "I have paid"; only an `OWNER` approving it (after checking the real bank account) creates tickets and queues the ticket email. Approval is atomic and idempotent. Full contract in `04-manual-payment.md`.
- **Hold policy:** 15 minutes to submit proof, then held until the owner decides, 48 h cap from first submission, up to 3 re-uploads after a resubmittable rejection. A proof arriving after expiry (within a 24 h grace) is still recorded and reviewed, so a real payment is never silently lost.
- **Bank details live in the database**, owner-editable with password re-entry and audit logging; never hardcoded in the front end.
- **Offline scanning is required.** Campus network is unreliable. The scanner prepares a local manifest, verifies Ed25519 signatures on-device, queues scans, and syncs with earliest-scan-wins conflict handling. Cross-device offline double entry is detected, not prevented. See `05`.
- **Event date can be unconfirmed.** `is_date_confirmed = false` hides calendar export and keeps sales closed; all times are Africa/Lagos.
- **Orders and Ticket Units are separate entities.** One order (one checkout, one email) can produce N ticket units, each independently trackable, each with its own signed QR code. Full contract in `05-ticketing-and-qr.md`.
- **Named tickets at checkout.** The purchaser can optionally label each ticket ("for me" / "for Chidi" / "for Amara") at checkout. This is both a nice-to-have UX feature and a door-side fraud deterrent (staff can eyeball-match name to ID). See `05-ticketing-and-qr.md`.
- **Admin and staff are role-gated, subdomain-separated, same backend.** `admin.silentrave.ng` and `staff.silentrave.ng` are frontend entry points against the same API and database, enforced server-side per request — not by hiding UI. Full contract in `06-auth-and-roles.md`.
- **Staff accounts are invite-only.** No public signup path for the staff subdomain. Small number of accounts (3–4 expected).
- **Event banner image upload** is a required field in the admin event create/edit form — this is the hero image shown on the event detail page and in listing cards, mirroring the original site's per-event flyer art.
- **"Buy Tickets" CTA is dynamic, not a static link.** Fixes a bug/ambiguity in the original site where `/buy-tickets/` 404s because there's no single canonical event.
  ```
  Clicked → query next upcoming published event (soonest future date)
     → exactly one exists → redirect to /event/{slug}#tickets (scroll to tier section)
     → multiple events tie on soonest date (e.g. same weekend, different cities)
         → redirect to an "upcoming events" list instead of guessing
     → none exist → friendly "no upcoming events — check back soon" state, never a 404
  ```
  This requires a live/cached lookup on page load, not a hardcoded nav link.

  **Ordering:** confirmed-date future events first. If there are none, published events with an unconfirmed date (one → its page, which shows "Date to be announced" and tiers as "Coming soon"; several → the list). Otherwise the empty state. This matters at launch: the first event's date is not confirmed.
- **Calendar export** — Google Calendar, iCalendar, Outlook 365, Outlook Live, downloadable `.ics`, all generated from one underlying ICS-generation function per event.
- **Email provider: Resend.** DB-backed job table (no Redis needed at this scale), exponential backoff retry, per-email delivery-status tracking (queued/sent/delivered/bounced, visible to admin), React Email templates for branded receipts. Ticket emails are queued **only** by owner approval; a receipt-acknowledgement email goes out on proof submission and a rejection email on rejection, and a status-link email when a buyer uses order lookup (`04-manual-payment.md`).

## Open decisions

These need to be resolved before or during the relevant build phase — they are flagged inline in the other docs too.

| Decision | Status | Notes |
|---|---|---|
| Next.js-only vs. Next.js + separate Laravel backend | **OPEN** — default assumption is Next.js full-stack unless told otherwise | Affects `03-api-routes.md` framing only; contracts are framework-agnostic |
| Refund flow automation | Deferred | Manual, status-only admin action for v1 (voids tickets) |
| Offline-mode for scanner | **Required for v1** | Design in `05-ticketing-and-qr.md` |
| Visual identity | Direction set | Use the client's HTML/CSS prototype look (dark card, mint and purple accents, poster art); port the look, don't redesign. Colours become CSS variables |
| Hosting / deployment target | **OPEN** | Default assumption Supabase (Postgres, Storage, Realtime); confirm before deployment, affects pooler settings and realtime transport |
| Domain and hostnames | **OPEN** | Final domain not chosen; hostnames must be configuration |
| Real event details | **OPEN** | Date, venue, description, ticket sale open date: placeholders until the client confirms |
| Google Maps Embed key | **OPEN** | Needs a Google Cloud project with billing enabled and a key restricted to the Maps Embed API and to HTTP referrers; fallback is a plain directions link with no iframe |
| Who else can approve payments | Decided | `OWNER` only |
| Multi-event "Buy Tickets" tie-break UX | Decided | See above — falls back to an upcoming-events list rather than guessing |
