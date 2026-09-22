# 02. Database Schema (Postgres)

Conventions: `id` columns are UUID (`gen_random_uuid()`), timestamps are `timestamptz`, money is stored in **kobo** (integer, smallest NGN unit) to avoid floating-point currency bugs — same convention Paystack itself uses. All monetary integer columns are named `_kobo`.

## Entity overview

```
Organizer ─┐
           ├─< Event >─┐
Venue ─────┘           ├─< TicketTier >─┐
                        │                ├─< TicketUnit >── Order
                        │                └────────────────────┘
                        └─< Order (event_id FK) ─< TicketUnit
StaffUser ─< AuditLogEntry
StaffUser ─< TicketUnit (checked_in_by)
EmailJob (references Order)
```

---

## `organizers`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| description | text | nullable |
| contact_email | text | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

## `venues`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| address | text | not null |
| city | text | not null |
| state | text | nullable (Nigerian state) |
| country | text | default 'Nigeria' |
| latitude | numeric(10,7) | nullable |
| longitude | numeric(10,7) | nullable |
| google_place_id | text | nullable — preferred over raw lat/lng when available, see Google Maps Integration note below |
| google_maps_url | text | nullable — fallback plain link if place_id/lat-lng aren't set |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Google Maps integration:** the reference site embeds a Google Maps iframe on each event's venue section and links out to a "+ Google Map" search. We reproduce this with the **Maps Embed API** (`https://www.google.com/maps/embed/v1/place?key=...&q=...`) rather than the full JS Maps SDK — it's a single iframe URL, no client-side map library or bundle weight, which matters for the mobile-first performance goal in `01-context.md`.

Two ways to build the embed query, in order of preference:
1. **`place_id`** (from Google Places API, resolved once at venue-creation time in the admin form via a Places Autocomplete field) — most reliable, survives address formatting quirks, and is what Google itself recommends over freeform address strings.
2. **`latitude`/`longitude`** — fallback if a place_id lookup wasn't done; still produces an accurate pin.

Freeform address-string queries (`q=<venue address>`) are a last resort only — geocoding a manually-typed address string is the least reliable of the three and is how the reference site's own venue addresses look slightly mangled in places. Prefer place_id or coordinates captured once by an admin, not re-geocoded on every page load.

The Maps API key used for the embed URL is a **server-side concern**: `map_embed_url` is constructed by the backend (`03-api-routes.md`) and returned as a ready-to-use iframe `src`, so the raw API key is never shipped in a way a client could lift and reuse elsewhere. If a **restricted** (HTTP-referrer-locked) browser key is used instead for a client-side embed, that's an acceptable alternative — just don't ship an *unrestricted* key.

## `events`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| slug | text | not null, unique — used in `/event/{slug}` |
| title | text | not null |
| description | text | not null — rich text/markdown body |
| banner_image_url | text | nullable — required by admin UI validation before publish, but nullable at DB level to allow draft save |
| organizer_id | uuid | FK → organizers.id, not null |
| venue_id | uuid | FK → venues.id, not null |
| starts_at | timestamptz | not null |
| ends_at | timestamptz | not null |
| status | enum | `DRAFT`, `PUBLISHED`, `CANCELLED` — default `DRAFT` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Index: `(status, starts_at)` — this is the hot query path for "next upcoming published event" and the events list views.

## `ticket_tiers`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| event_id | uuid | FK → events.id, not null, on delete cascade |
| name | text | not null — e.g. "Early Bird", "First Phase" |
| price_kobo | integer | not null, >= 0 |
| capacity | integer | not null, >= 0 — total sellable units |
| sold | integer | not null, default 0 |
| reserved | integer | not null, default 0 — soft-held by in-progress checkouts (see below) |
| sort_order | integer | default 0 — controls display order (Early Bird above First Phase, etc.) |
| sales_start_at | timestamptz | nullable — tier not purchasable before this |
| sales_end_at | timestamptz | nullable — tier not purchasable after this |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Constraint:** `CHECK (sold + reserved <= capacity)` — enforced at the DB level as a backstop, not just application logic.

**Availability formula:** `available = capacity - sold - reserved`. "Sold Out" in the UI = `available <= 0`.

## `orders`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — this is the human-facing "order reference" |
| event_id | uuid | FK → events.id, not null |
| customer_name | text | not null |
| customer_email | text | not null |
| customer_phone | text | nullable |
| total_kobo | integer | not null |
| status | enum | `PENDING`, `PAID`, `FAILED`, `EXPIRED`, `REFUNDED` — default `PENDING` |
| paystack_reference | text | unique, not null — our generated reference sent to Paystack, also the idempotency key |
| paystack_transaction_id | text | nullable — populated after verified |
| reserved_until | timestamptz | not null — checkout TTL expiry (see Inventory Reservation below) |
| paid_at | timestamptz | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Index: `paystack_reference` (unique, already implied), `(status, reserved_until)` for the expiry sweep job.

## `ticket_units`

This is the entity that actually gets scanned at the door. One row per physical/PDF ticket, not one row per order.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — the internal ticket ID |
| order_id | uuid | FK → orders.id, not null, on delete cascade |
| tier_id | uuid | FK → ticket_tiers.id, not null |
| holder_name | text | nullable — optional per-ticket name entered at checkout |
| qr_token | text | unique, not null — the **signed** payload embedded in the QR code (see `05-ticketing-and-qr.md`) |
| check_in_status | enum | `NOT_CHECKED_IN`, `CHECKED_IN` — default `NOT_CHECKED_IN` |
| checked_in_at | timestamptz | nullable |
| checked_in_by | uuid | FK → staff_users.id, nullable |
| pdf_url | text | nullable — generated after payment confirmation, stored in object storage |
| created_at | timestamptz | default now() |

Index: `qr_token` (unique — this is the scanner's lookup key), `order_id`.

## `staff_users`

Covers both `admin`/`owner` and `staff` roles — same table, different `role` value, since both authenticate against the same backend.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| email | text | unique, not null |
| password_hash | text | not null |
| role | enum | `OWNER`, `STAFF` |
| invited_by | uuid | FK → staff_users.id, nullable (null for the first owner account) |
| is_active | boolean | default true — deactivate instead of delete, to preserve audit trail integrity |
| created_at | timestamptz | default now() |
| last_login_at | timestamptz | nullable |

## `audit_log_entries`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | FK → staff_users.id, not null |
| action | text | not null — e.g. `EVENT_CREATED`, `TIER_PRICE_CHANGED`, `ORDER_REFUNDED`, `TICKET_CHECKED_IN` |
| entity_type | text | not null — e.g. `event`, `order`, `ticket_unit` |
| entity_id | uuid | not null |
| metadata | jsonb | nullable — before/after values, free-form context |
| created_at | timestamptz | default now() |

Every financially significant admin action and every check-in scan writes a row here. This is append-only — no update/delete API exposed for this table.

## `email_jobs`

The DB-backed queue replacing Redis for this scale.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | FK → orders.id, not null |
| recipient_email | text | not null |
| status | enum | `QUEUED`, `SENT`, `DELIVERED`, `BOUNCED`, `FAILED` — default `QUEUED` |
| attempts | integer | default 0 |
| next_attempt_at | timestamptz | default now() |
| last_error | text | nullable |
| resend_message_id | text | nullable — populated once Resend accepts the send |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Index: `(status, next_attempt_at)` — the worker's polling query.

---

## Inventory reservation mechanics

`ticket_tiers.reserved` exists specifically to solve the "last ticket" race condition and the "add to cart, then it's gone at payment" UX problem.

**On checkout initiation** (order created with status `PENDING`):
```sql
UPDATE ticket_tiers
SET reserved = reserved + :quantity
WHERE id = :tier_id
  AND (capacity - sold - reserved) >= :quantity;
-- 0 rows affected = not enough inventory, reject checkout
```
This must run inside the same transaction that creates the `orders` row, and `orders.reserved_until` is set to `now() + interval '15 minutes'`.

**On confirmed payment** (webhook/verify path, see `04-paystack-integration.md`):
```sql
UPDATE ticket_tiers
SET sold = sold + :quantity, reserved = reserved - :quantity
WHERE id = :tier_id;
```

**On expiry** (background sweep job, runs every minute):
```sql
UPDATE orders SET status = 'EXPIRED'
WHERE status = 'PENDING' AND reserved_until < now();

UPDATE ticket_tiers t SET reserved = reserved - o.quantity
FROM (
  SELECT tier_id, SUM(quantity) as quantity
  FROM order_line_items -- see note below
  JOIN orders o ON o.id = order_line_items.order_id
  WHERE o.status = 'EXPIRED' AND NOT o.inventory_released
  GROUP BY tier_id
) o
WHERE t.id = o.tier_id;
```

**Note on line items:** the schema above generates `ticket_units` per individual ticket, but at checkout time (before payment) you don't yet want to create N fully-formed ticket units with QR codes for an unpaid order — QR codes should only be minted for tickets attached to a `PAID` order. Two implementation options, pick one and note it as a project convention:

- **Option A (recommended):** an `order_line_items` table (`order_id`, `tier_id`, `quantity`, `holder_names jsonb`) capturing cart contents at checkout time; `ticket_units` rows (with QR tokens) are only generated from these line items *after* payment is confirmed.
- **Option B:** create `ticket_units` rows immediately at checkout with `qr_token` nulled out and populate it only on payment confirmation.

Option A keeps `ticket_units` semantically "this is a real, payable ticket" and avoids ever generating a QR-bearing row for money that hasn't arrived. **Add `order_line_items` to the schema above if Option A is chosen** (recommended default for this spec).

## State machine reference

**Order status:**
```
PENDING → PAID
PENDING → FAILED     (Paystack reports failure)
PENDING → EXPIRED    (reserved_until lapses, sweep job)
PAID → REFUNDED       (manual admin action, v1)
```
No other transitions are valid. `PAID` and `EXPIRED`/`FAILED` are terminal except for the `REFUNDED` exception.

**Ticket unit check-in:**
```
NOT_CHECKED_IN → CHECKED_IN   (valid scan)
CHECKED_IN → CHECKED_IN        (rejected as a no-op scan; UI shows "already scanned" — status does not change, but the attempt itself should be logged in audit_log_entries as a duplicate-scan attempt, for door-abuse pattern detection)
```
