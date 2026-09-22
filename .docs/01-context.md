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
| Payments | Paystack — non-negotiable, sole payment rail for v1 |
| Email | Resend + React Email templates |
| Email queue | DB-backed job table (no Redis) |
| PDF generation | Per-ticket PDF with embedded QR (see `05-ticketing-and-qr.md`) |
| QR | Signed tokens (HMAC), not raw sequential IDs |
| File storage | Supabase Storage or S3 (event banner images, generated PDFs) |

## Core principle: behavioral parity, not implementation parity

The original's plugin chain (Events Calendar → Tickets → Cart → Checkout → Payment) is replaced by our own Events/Venues/Organizers/Tickets/Orders schema on Postgres, our own cart/checkout flow, and Paystack for payment — but the *customer-facing experience* should feel equivalent or better.

## Site structure (module tree)

```
Silent Rave
├── 01. Global Shell — Header, Nav, Cart, Footer
├── 02. Homepage — Hero, upcoming event sections, CTAs
├── 03. Events — List / Month / Day views, Search, Filtering
├── 04. Event Detail — Hero, metadata, Venue, Map, Organizer, Add-to-calendar, Ticket tiers
├── 05. Ticketing — Tiers, Inventory, Quantity, Cart, Checkout, Confirmation
├── 06. Static Pages — About, Contact
├── 07. Admin (owner) — Events (incl. banner upload), Venues, Organizers,
│                        Ticket tiers, Inventory, Orders, Staff accounts, Audit log
├── 08. Staff (subdomain) — QR scanner / check-in only, no financial data access
└── 09. Visual System — Typography, Colors, Spacing, Components, Responsive behavior, Animations (mobile-first)
```

## Key product decisions locked in

- **Payment verification is server-side and idempotent.** Never fulfill an order, generate tickets, or send email based solely on the browser reporting success. Full contract in `04-paystack-integration.md`.
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
- **Calendar export** — Google Calendar, iCalendar, Outlook 365, Outlook Live, downloadable `.ics`, all generated from one underlying ICS-generation function per event.
- **Email provider: Resend.** DB-backed job table (no Redis needed at this scale), exponential backoff retry, per-email delivery-status tracking (queued/sent/delivered/bounced, visible to admin), React Email templates for branded receipts. Strict trigger rule: only send after Paystack server-side verification.

## Open decisions

These need to be resolved before or during the relevant build phase — they are flagged inline in the other docs too.

| Decision | Status | Notes |
|---|---|---|
| Next.js-only vs. Next.js + separate Laravel backend | **OPEN** — default assumption is Next.js full-stack unless told otherwise | Affects `03-api-routes.md` framing only; contracts are framework-agnostic |
| Refund flow automation | Deferred | Manual admin action for v1; Paystack refund API documented as a future step |
| Offline-mode for scanner | Deferred | Stretch goal, not required for v1 — see `05-ticketing-and-qr.md` |
| Final visual/brand identity | **OPEN** | Name is locked ("Silent Rave"); visual system awaits reference images / brand assets |
| Multi-event "Buy Tickets" tie-break UX | Decided | See above — falls back to an upcoming-events list rather than guessing |
