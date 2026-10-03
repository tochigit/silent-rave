# 03. API Routes

Conventions: all routes are prefixed `/api`. Request/response bodies are JSON. Money fields are in kobo unless noted. Auth-gated routes are marked with the required role; unmarked routes are public/unauthenticated.

---

## Public — Events

### `GET /api/events`
List published events. Supports the List/Month/Day views described in `01-context.md`.

Query params: `view` (`list` | `month` | `day`), `date`, `search`, `page`.

Step 3 additions: `city` (case-insensitive exact city), `filter=all|upcoming`.
Pages contain 12 events, ordered by start then ID. `date` is `YYYY-MM-DD`
(day/list) or `YYYY-MM` (month); date filters include confirmed events overlapping
that Lagos day/month. Unconfirmed dates return null timestamps; draft/cancelled
events are excluded from lists. Invalid query/date returns 400. Month calendars
show the current results page and include pagination; day links retain filters.

Response:
```json
{
  "events": [
    {
      "id": "uuid", "slug": "example-silent-rave", "title": "Example Event – Silent Rave",
      "banner_image_url": "...", "starts_at": "...", "ends_at": "...",
      "venue": { "name": "...", "city": "..." },
      "price_range": { "min_kobo": 420000, "max_kobo": 520000 },
      "sold_out": false
    }
  ],
  "pagination": { "page": 1, "total_pages": 1 }
}
```

### `GET /api/events/:slug`
Full event detail: description, `is_date_confirmed`, venue (with map embed data — see Google Maps Integration below), organizer, ticket tiers with live availability, calendar export links.

Venue object shape returned:
```json
{
  "name": "Example Venue",
  "address": "1 Example Road, Example Town, Example State",
  "city": "Example Town",
  "latitude": 0.0,
  "longitude": 0.0,
  "map_embed_url": "https://www.google.com/maps/embed/v1/place?key=RESTRICTED_EMBED_KEY&q=place_id:ChIJ...",
  "directions_url": "https://www.google.com/maps/search/?api=1&query=Example%20Venue&query_place_id=ChIJ..."
}
```
`map_embed_url` is constructed server-side so the key is assembled in one place, but be honest about what that buys: an iframe `src` is visible to the browser, so the key **is** visible to a determined user. The real protection is the key itself: it must be restricted to the **Maps Embed API only** and to **HTTP referrers** for the site's hostnames (`02`). `directions_url` prefers `query_place_id` (with `query` as the human-readable label) and falls back to latitude/longitude, then to `google_maps_url`. If no Maps key exists yet, `map_embed_url` is `null` and the UI shows only the directions link.

### `GET /api/events/next-upcoming`
Backs the dynamic "Buy Tickets" CTA (`01-context.md`). Ordering: (1) published, **date-confirmed** events that have not ended, soonest `starts_at` first; a tie means several events on the same Africa/Lagos calendar date. (2) If there are none, published events with an **unconfirmed** date: exactly one → `single` (its page shows "Date to be announced" and the tiers as "Coming soon"), several → `multiple`. (3) Otherwise `none`. Returns the single soonest such event, a tie flag, or none. This matters at launch: the first event has no confirmed date.
```json
{ "result": "single", "event": { "slug": "..." } }
{ "result": "multiple", "events": [{ "slug": "..." }, { "slug": "..." }] }
{ "result": "none" }
```

### `GET /api/events/:slug/calendar/:format`
`:format` ∈ `google | ical | outlook365 | outlooklive | ics`. Returns a redirect (for the hosted-provider formats) or a downloadable `.ics` file, generated from the same underlying ICS-generation function per event. Times are emitted with the correct Africa/Lagos offset (UTC+1), never as local time labelled `Z`. Returns `404`-free empty state ("date to be announced") when `is_date_confirmed = false`; the UI hides calendar options in that case.

---

## Public — Checkout (manual bank transfer; see `04-manual-payment.md`)

### `POST /api/checkout/initialize`
Creates the order (`AWAITING_PAYMENT`) and `order_line_items`, soft-reserves inventory atomically (`02`), and returns what the buyer needs to pay. Prices are never accepted from the client.

Request:
```json
{
  "event_id": "uuid",
  "customer_name": "...", "customer_email": "...", "customer_phone": "...",
  "line_items": [ { "tier_id": "uuid", "quantity": 3, "holder_names": ["Me", "Chidi", "Amara"] } ]
}
```
`holder_names` length must equal `quantity` or be omitted. Validation: event `PUBLISHED`, `is_date_confirmed` and **not ended** (`ends_at > now()`), tier belongs to event, sales window open, `quantity <= MAX_QTY_PER_ORDER`, email/phone format, per-email and per-phone unresolved-order limits (2 each) and rate limits. IP is a rate limit only, not an unresolved-order cap (shared campus NAT), see `04`.

Response:
```json
{
  "order_code": "SR-4F9K2X", "status_token": "<derived token, see 02 orders.status_token_version>",
  "amount_kobo": 600000, "hold_expires_at": "...",
  "payment_account": { "bank_name": "...", "account_number": "...", "account_name": "..." }
}
```
Errors: `409` insufficient inventory on any line (nothing partially reserved), `429` limits.

### `POST /api/orders/:code/proof` — "I have paid"
Multipart. Fields: `proof` (image), `transfer_reference`, `sender_name`, `client_submission_id`; requires the order's `status_token` (header or query). Idempotent on `client_submission_id`. Full validation, storage and transition contract in `04-manual-payment.md`. Returns `{ status, attempt_no, late?: true }`. A proof on an `EXPIRED` order with no proof yet is accepted within `LATE_PROOF_GRACE` (`late: true`, order stays `EXPIRED`; see `04` "Late proofs"). Errors: `409` duplicate `transfer_reference` among pending/approved proofs, `410` hold expired and outside the late-proof grace, `422` bad file, `403` resubmissions exhausted. An unknown order code, a wrong token and a missing token are indistinguishable: all return the same `404` body, exactly as on the status route.

### `GET /api/orders/:code/status`

Step 3 allowlisted additions: `amount_kobo`, `event_title`, `payment_account`
(the checkout snapshot, never a currently active account), `pending_proof`,
`can_submit_proof`, `late_proof_deadline`; approved tickets include `voided`.
Null legacy snapshots do not fall back to a different bank account. All status
responses are private/no-store/no-referrer. Pending proofs remain visible at
expiry, including timely proofs reaching the 48-hour review cap.
Requires `status_token`. Returns `status`, `proof_attempts`, `max_resubmissions`, latest reject reason/message if `NEEDS_RESUBMIT`/`REJECTED`, `hold_expires_at`, `late_proof_received` when an `EXPIRED` order has a late proof, and — only when `APPROVED` — the ticket list with download links to `GET /api/orders/:code/tickets/:ticketId/pdf` (requires `status_token`; the PDF is generated on demand and cached, so the page works before the email worker has run; Phase 4). An unknown code, wrong token or missing token returns one uniform `404`. No other PII beyond what the buyer entered.

### `GET /api/orders/:code/tickets/:ticketId/pdf`
Requires `status_token` (header or query, since it is used as a link). Unknown order, unknown ticket, a ticket belonging to a different order, a wrong token and a missing token all return the same `404`. With a valid token: order not `APPROVED` → `409`; ticket voided or order `REFUNDED` → `410`; otherwise the PDF (`Content-Type: application/pdf`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`). Generation and caching rules: `05`.

### `POST /api/orders/lookup`
`{ order_code, email }` → always `202` with the same generic message ("If those details match an order, we have emailed its status link"). When code and email match, enqueue a `STATUS_LINK` email job (fresh dedupe key; the link is derived, so nothing is stored or rotated). **It never returns order data directly.** Strictly rate-limited per IP and per order code; response and timing must not reveal whether the code or the email was wrong.

---

## Static content

### `GET /api/pages/:slug`

Step 3 resolves the open persistence decision: `site_pages` stores only `about`
and `contact`, published content returns `{slug,title,body,updated_at}`. Missing,
unpublished and unsupported slugs return 404. Body is escaped plain text.
Organizer contact routing stays server-side. Owner editing UI belongs to Step 4.
Backs the About/Contact static pages if content-managed rather than hardcoded. (**OPEN**: confirm with client whether About/Contact need to be admin-editable or can be static JSX — if static, this route isn't needed at all.)

### `POST /api/contact`

Step 3: strict `{name,email,message}` input, name 1-200, valid email <=254,
message 10-5000 characters, 16 KiB streaming body cap, 5 requests/hour/IP.
Recipient is the published Contact page's organizer, never client supplied.
Capture/Resend transport is independent of order jobs. Success 202, malformed
400, too large 413, limited 429, unavailable configuration/provider 503. Messages
are not persisted; fixed sender/reply-to prevents user-controlled mail headers.
Contact form submission ("Send Brief" equivalent from the reference site). Sends an email to the organizer's contact address; no DB persistence required unless the client wants submitted briefs logged.

---

## Admin (`role: OWNER`, `admin.silentrave.ng`)

All routes below require a valid session with role `OWNER`. Non-owner or unauthenticated requests get `401`/`403` per `06-auth-and-roles.md`.

### Events
- `GET /api/admin/events` — includes drafts and cancelled, unlike the public list
- `POST /api/admin/events` — create (status defaults to `DRAFT`)
- `PATCH /api/admin/events/:id` — update, including `status` transitions (`DRAFT → PUBLISHED`, `→ CANCELLED`)
- `POST /api/admin/events/:id/banner` — multipart upload, stores to object storage, sets `banner_image_url`
- `DELETE /api/admin/events/:id` — hard delete only permitted if no orders reference it; otherwise reject and suggest `CANCELLED` status instead

### Venues / Organizers
- `GET/POST/PATCH/DELETE /api/admin/venues`
- `GET/POST/PATCH/DELETE /api/admin/organizers`
Standard CRUD, no special notes beyond: deleting a venue/organizer referenced by an existing event should be rejected (foreign key protection), not silently orphan the event.

**Venue create/edit form specifically:** the address field should be a Google Places Autocomplete input, not a plain text box — selecting a suggestion populates `google_place_id`, `latitude`, `longitude`, and a normalized `address` string in one action. This is what makes the map embed reliable (see `02-database-schema.md`, Google Maps Integration note) and avoids admins hand-typing addresses that don't geocode cleanly, which is a visible flaw in the reference site's own venue listings.

### Ticket tiers
- `GET /api/admin/events/:id/tiers`
- `POST /api/admin/events/:id/tiers` — create tier
- `PATCH /api/admin/tiers/:id` — update price/capacity/sales window. **Writes `audit_log_entries` (`TIER_PRICE_CHANGED` or `TIER_CAPACITY_CHANGED`)** if price or capacity actually changed.
- `DELETE /api/admin/tiers/:id` — reject if `sold > 0`

### Payments and orders (`OWNER` only)
- `GET /api/admin/payments?status=PROOF_SUBMITTED|NEEDS_RESUBMIT|EXPIRED_HAD_PROOF` (`EXPIRED_HAD_PROOF` = `EXPIRED` with a `PENDING` proof) — review queue, oldest first, with age and urgency near the 48 h cap. Supports pagination and search by code, email, phone, transfer reference.
- `GET /api/admin/orders/:id` — full detail: buyer info, line items, all proof attempts, flags, ticket units and check-in state. Proof images come as **signed URLs valid 60–120 s**, minted per request for `OWNER` only.
- `POST /api/admin/orders/:id/approve` — body `{ "confirmed_in_bank": true, "note"?: string }`. Runs `approveOrder` (`04`). Idempotent; returns `CAPACITY_GONE` on a failed revive and `EVENT_CANCELLED` if the event was cancelled.
- `POST /api/admin/orders/:id/reject` — body `{ reason_code, message, final }`. Runs `rejectOrder`; allowed from `PROOF_SUBMITTED`, `NEEDS_RESUBMIT` (close) and `EXPIRED` with a `PENDING` proof (dismiss, always final).
- `POST /api/admin/orders/:id/refund` — status-only `REFUNDED`, voids tickets, optional `{ restock: boolean, note?: string, acknowledge_checked_in?: boolean }`. Only from `APPROVED`; idempotent (a second call on a `REFUNDED` order is a no-op and never restocks twice). If any ticket in the order is already checked in, it fails `409 CHECKED_IN_TICKETS` unless `acknowledge_checked_in: true`. Writes `ORDER_REFUNDED` with the `restock` and acknowledgement choices.
- `POST /api/admin/orders/:id/resend-tickets` — new `TICKETS` email job with a fresh dedupe key; only for `APPROVED` orders (`409` otherwise); rate-limited per order (default 5 per hour); audit-logged as `TICKET_RESENT`. It never accepts a different recipient: the job goes to `orders.customer_email`.
- `GET /api/admin/email-jobs?status=&order_id=` -- read-only list of email jobs (kind, status, attempts, `last_error`, timestamps; never the status link or any token). `GET /api/admin/orders/:id` also includes that order's email jobs, so the owner can see a bounced or failed ticket email.
- `POST /api/admin/orders/issue` — admin-issued `CASH` or `COMP` order (door sales, VIP, guest list): creates an `APPROVED` order, mints tickets, no proof required, source and reason audit-logged. (Spec'd now; may be built after the core flow.)
- `GET /api/admin/orders` — filter by event, status, date, source.
- `GET /api/admin/reconciliation?event_id=&format=csv` — approved orders with buyer, tier, quantity, amount, transfer reference, approved time and approver, for checking against the bank statement, plus totals.

### Payment accounts (`OWNER` only)
- `GET /api/admin/payment-accounts`
- `POST /api/admin/payment-accounts`, `PATCH /api/admin/payment-accounts/:id` (including activate). **Requires password re-entry in the body.** Writes `BANK_ACCOUNT_CHANGED` with before/after.

### Push and realtime (`OWNER` only)
- `POST /api/admin/push/subscribe`, `DELETE /api/admin/push/subscribe` — register/remove a Web Push subscription (VAPID).
- `GET /api/admin/push/status` — whether the caller has an active subscription (drives the admin banner).
- Realtime events are emitted server-side after commit; clients must also poll (`04`).

### Staff accounts
- `GET /api/admin/staff` — list, including `is_active`
- `POST /api/admin/staff` — create invite-only account. Writes `STAFF_ACCOUNT_CREATED`
- `PATCH /api/admin/staff/:id` — e.g. deactivate. Writes `STAFF_ACCOUNT_DEACTIVATED`

### Audit log and scans
- `GET /api/admin/audit-log` — read-only, filterable by actor/action/date/entity; unions `audit_log_entries` and `check_in_scans`. No write/delete endpoints exist.
- `GET /api/admin/events/:id/checkins` — scan ledger and live counts, including `CONFLICT` scans for review.

---

## Staff (`STAFF` or `OWNER`, `staff.silentrave.ng`)

The scanner is an offline-capable PWA (see `05-ticketing-and-qr.md`). Every request also enforces the Origin check in `06`.

### `GET /api/staff/events`
Events the scanner can be prepared for (today/upcoming, published, date confirmed).

### `GET /api/staff/events/:id/manifest?since=<sync_seq>`
Prepares/updates the offline list. Returns `{ event_id, server_time, next_since, public_keys: [{kid, key}], tickets: [{ id, tier_name, holder_name, check_in_status, checked_in_at, voided }] }`. Without `since`: full list. With `since`: rows with `sync_seq > since - SYNC_OVERLAP` (`SYNC_OVERLAP` = 1000) — new approvals, other devices' check-ins, voids. The overlap is deliberate: sequence values are not commit-ordered, so a strict `> since` can skip a late-committing row forever. `next_since` is the highest `sync_seq` returned; the device merges by ticket id, idempotently (a checked-in state is never reverted by a stale row). **Contains no email, phone, or payment data.**

### `POST /api/staff/check-in`  (online, single scan)
Request: `{ "token": "...", "event_id": "uuid", "device_id": "...", "client_scan_id": "...", "scanned_at"?: "..." }`. Always `200`; `result` ∈ `valid | duplicate | invalid | wrong_event | void`. Signature is verified before any DB access; the check-in transition is one atomic conditional UPDATE. Response fields on `valid`/`duplicate`: tier name, holder name, event name, `checked_in_at`, `checked_in_by_name`.

### `POST /api/staff/check-in/batch`  (offline sync)
Request: `{ device_id, clock_offset_ms, scans: [{ client_scan_id, token, event_id, scanned_at }] }`. Idempotent per `client_scan_id`. Each scan may carry `not_in_manifest: true` (stored in `check_in_scans.flags`). Server verifies each token, applies scans in `scanned_at` order (earliest wins), records every scan in `check_in_scans`, marks losers `CONFLICT`. Response: per-scan result plus the manifest delta since the device's last `sync_seq`.

### `GET /api/staff/attendee-list`
Read-only, event-scoped: holder names and check-in status only. No pricing, no buyer contact data.

---

## Internal / background jobs

| Job | Trigger | Behavior |
|---|---|---|
| Hold expiry sweep | Cron-triggered `POST /api/internal/expire-holds` (guarded by `CRON_SECRET`) **and** lazily at the start of `checkout/initialize` | One transaction, `FOR UPDATE SKIP LOCKED`, sets `EXPIRED` + `inventory_released`, decrements `reserved`. Idempotent. See `02`. |
| Email job worker | Polling/cron | Processes `email_jobs` (`QUEUED`, `next_attempt_at <= now()`), generates PDFs for `TICKETS` jobs, sends via Resend, backoff and status updates as in `04` "Email worker". Invoked by `POST /api/internal/process-email-jobs` (guarded by `CRON_SECRET`, like the sweep) and, best effort, right after the commit that queued a job. Never inside a DB transaction. |
| Resend webhook receiver | Event-driven | `POST /api/webhooks/resend` — signature verified over the raw body with a replay window (Resend signs with the Svix scheme; verify against Resend's current docs); updates `email_jobs.status` on `delivered`/`bounced` monotonically (`04` "Email worker"). |
| Push dispatcher | After commit of proof submit/resubmit | Sends Web Push to active `OWNER` subscriptions; deactivates dead endpoints. |
