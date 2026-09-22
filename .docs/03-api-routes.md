# 03. API Routes

Conventions: all routes are prefixed `/api`. Request/response bodies are JSON. Money fields are in kobo unless noted. Auth-gated routes are marked with the required role; unmarked routes are public/unauthenticated.

---

## Public — Events

### `GET /api/events`
List published events. Supports the List/Month/Day views described in `01-context.md`.

Query params: `view` (`list` | `month` | `day`), `date`, `search`, `page`.

Response:
```json
{
  "events": [
    {
      "id": "uuid", "slug": "owerri-all-white-affair", "title": "Owerri – All White Affair",
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
Full event detail: description, venue (with map embed data — see Google Maps Integration below), organizer, ticket tiers with live availability, calendar export links.

Venue object shape returned:
```json
{
  "name": "Euro Life Arena",
  "address": "No.9 Spibat Road, close to Belmont Kas Hospital, Owerri, Imo State",
  "city": "Owerri",
  "latitude": 5.4840,
  "longitude": 7.0351,
  "map_embed_url": "https://www.google.com/maps/embed/v1/place?key=SERVER_SIDE_KEY&q=place_id:ChIJ...",
  "directions_url": "https://www.google.com/maps/search/?api=1&query=5.4840,7.0351"
}
```
`map_embed_url` is constructed server-side (see below) so the Maps API key is never exposed in a client-fetched payload as a raw queryable credential the way the reference site's markup does.

### `GET /api/events/next-upcoming`
Backs the dynamic "Buy Tickets" CTA (`01-context.md`). Returns the single soonest published upcoming event, or a flag indicating a tie (multiple events on the same soonest date) or none exists.
```json
{ "result": "single", "event": { "slug": "..." } }
{ "result": "multiple", "events": [{ "slug": "..." }, { "slug": "..." }] }
{ "result": "none" }
```

### `GET /api/events/:slug/calendar/:format`
`:format` ∈ `google | ical | outlook365 | outlooklive | ics`. Returns a redirect (for the hosted-provider formats) or a downloadable `.ics` file, generated from the same underlying ICS-generation function per event.

---

## Public — Checkout

### `POST /api/checkout/initialize`
Begins a checkout. Creates the `orders` row (status `PENDING`) and `order_line_items`, soft-reserves inventory (`02-database-schema.md`), calls Paystack's initialize endpoint (`04-paystack-integration.md`), and returns the Paystack redirect/authorization URL.

Request:
```json
{
  "event_id": "uuid",
  "customer_name": "...",
  "customer_email": "...",
  "customer_phone": "...",
  "line_items": [
    { "tier_id": "uuid", "quantity": 3, "holder_names": ["Me", "Chidi", "Amara"] }
  ]
}
```
`holder_names` array length must equal `quantity` if provided, or be omitted entirely (all tickets unnamed).

Response:
```json
{ "order_id": "uuid", "paystack_reference": "...", "authorization_url": "https://checkout.paystack.com/..." }
```
Errors: insufficient inventory on any line item → `409`, do not partially reserve.

### `POST /api/checkout/verify`
Frontend-triggered verification after Paystack redirects back. See `04-paystack-integration.md` for the full trust model — this endpoint independently re-verifies with Paystack rather than trusting the client.

Request: `{ "reference": "..." }`
Response: `{ "status": "PAID" | "PENDING" | "FAILED", "order": { ... } }`

### `POST /api/webhooks/paystack`
Paystack webhook receiver. HMAC-signature-verified (`04-paystack-integration.md`). Not called by the frontend — registered directly in the Paystack dashboard.

### `GET /api/orders/:id/confirmation`
Public confirmation-page data lookup (order reference + email match, or a signed link) — shows order summary post-payment without requiring login. Exact access-control shape (reference-only vs. reference+email) is an implementation detail to settle during build; either is acceptable since this endpoint exposes no more than what's already emailed to the customer.

---

## Static content

### `GET /api/pages/:slug`
Backs the About/Contact static pages if content-managed rather than hardcoded. (**OPEN**: confirm with client whether About/Contact need to be admin-editable or can be static JSX — if static, this route isn't needed at all.)

### `POST /api/contact`
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

### Orders
- `GET /api/admin/orders` — filterable by event, status, date range
- `GET /api/admin/orders/:id` — full detail including all ticket units and their check-in status
- `POST /api/admin/orders/:id/refund` — marks order `REFUNDED` (manual, v1). **Writes `audit_log_entries` (`ORDER_REFUNDED`)**. Does not automatically call Paystack's refund API in v1 (see `01-context.md` open decisions) — this is a status-only action; actual money movement is handled by the owner directly in the Paystack dashboard for now.

### Staff accounts
- `GET /api/admin/staff` — list, including `is_active` status
- `POST /api/admin/staff` — create invite-only staff account. **Writes `audit_log_entries` (`STAFF_ACCOUNT_CREATED`)**
- `PATCH /api/admin/staff/:id` — e.g. deactivate (`is_active: false`). **Writes `audit_log_entries` (`STAFF_ACCOUNT_DEACTIVATED`)** on deactivation

### Audit log
- `GET /api/admin/audit-log` — read-only, filterable by actor/action/date/entity. No write/delete endpoints exist for this resource by design.

---

## Staff (`role: STAFF` or `OWNER`, `staff.silentrave.ng`)

### `POST /api/staff/check-in`
The scanner endpoint. Full contract and state-branching logic in `05-ticketing-and-qr.md`.

Request: `{ "token": "<scanned QR payload>" }`
Response (always `200`, `result` field distinguishes outcome):
```json
{ "result": "valid", "tier_name": "First Phase", "holder_name": "Chidi", "event_name": "..." }
{ "result": "duplicate", "checked_in_at": "...", "checked_in_by_name": "..." }
{ "result": "invalid" }
```

### `GET /api/staff/attendee-list`
Optional read-only "tonight's attendee list" — event-scoped, shows holder names and check-in status, no pricing/financial fields. (**OPEN**: confirm whether this is wanted for v1 or deferred — it's cheap to build alongside `check-in` since it queries the same `ticket_units` table, but wasn't explicitly requested, only mentioned as a "prolly" maybe.)

---

## Internal / background jobs (not HTTP-exposed, but part of the system contract)

| Job | Frequency | Behavior |
|---|---|---|
| Reservation expiry sweep | Every 1 minute | Marks `PENDING` orders past `reserved_until` as `EXPIRED`, releases reserved inventory. See `02-database-schema.md`. |
| Email job worker | Continuous/polling | Processes `email_jobs` where `status = QUEUED` and `next_attempt_at <= now()`, sends via Resend, updates status, applies exponential backoff on failure. |
| Resend webhook receiver | N/A (event-driven) | `POST /api/webhooks/resend` — updates `email_jobs.status` based on delivery events (`delivered`, `bounced`, etc.) from Resend. Not previously listed — needed to fulfill the "admin can see whether the receipt was delivered/bounced" requirement from `01-context.md`. |
