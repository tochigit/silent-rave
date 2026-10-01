# 02. Database Schema (Postgres)

Conventions: `id` columns are UUID (`gen_random_uuid()`), timestamps are `timestamptz`, money is stored in **kobo** (integer, smallest NGN unit) to avoid floating-point currency bugs. All monetary integer columns are named `_kobo`.

## Entity overview

```
Organizer ─┐
           ├─< Event >─┐
Venue ─────┘           ├─< TicketTier >─┐
                        │                ├─< TicketUnit >── Order
                        │                └────────────────────┘
                        └─< Order (event_id FK) ─< TicketUnit
Order ─< OrderLineItem ; Order ─< PaymentProof ; Order >── PaymentAccount
StaffUser ─< AuditLogEntry ; StaffUser ─< PushSubscription
StaffUser ─< TicketUnit (checked_in_by) ; TicketUnit ─< CheckInScan
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

`map_embed_url` is constructed by the backend (`03-api-routes.md`) and returned as a ready-to-use iframe `src`. Be honest about the key: an iframe `src` is visible to the browser, so the key is not secret. The protection is the key's restrictions: it **must** be restricted to the **Maps Embed API only** and to **HTTP referrers** for the site's configured hostnames, never an unrestricted key. If no key exists yet, `map_embed_url` is `null` and the UI shows the directions link only.

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
| is_date_confirmed | boolean | not null, default false — when false the site shows "Date to be announced", hides all add-to-calendar options, and ticket sales stay closed until the owner confirms. Times are stored as timestamptz and displayed/exported in Africa/Lagos (UTC+1); never write local times with a `Z` suffix |
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

**Constraints (DB-level backstops, not just application logic):** `CHECK (sold + reserved <= capacity)` and `CHECK (reserved >= 0 AND sold >= 0)`.

**Availability formula:** `available = capacity - sold - reserved`. "Sold Out" in the UI = `available <= 0`.

## `orders`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK (internal) |
| order_code | text | unique, not null — human-facing reference, e.g. `SR-4F9K2X`; random from an unambiguous alphabet (no 0/O/1/I), non-sequential; the buyer writes it in the transfer narration |
| status_token_version | integer | not null, default 1 — the buyer's status-link token is **derived, not stored**: `base64url(HMAC-SHA256(STATUS_TOKEN_SECRET, order_id ":" status_token_version))`, verified by recomputation with a constant-time compare. Because it is derivable, the email worker can put the link into any email without a raw token ever being persisted. Bumping the version invalidates old links |
| event_id | uuid | FK → events.id, not null |
| customer_name | text | not null |
| customer_email | text | not null |
| customer_phone | text | nullable at DB level, with `CHECK (source <> 'ONLINE' OR customer_phone IS NOT NULL)` — required for online orders, optional for admin-issued ones |
| total_kobo | integer | not null — computed server-side from `price_kobo`, never from the client |
| status | enum | `AWAITING_PAYMENT`, `PROOF_SUBMITTED`, `NEEDS_RESUBMIT`, `APPROVED`, `REJECTED`, `EXPIRED`, `REFUNDED` — default `AWAITING_PAYMENT` |
| source | enum | `ONLINE`, `CASH`, `COMP` — default `ONLINE` (admin-issued door/comp tickets use the other two) |
| payment_account_id | uuid | FK → payment_accounts.id — the account the buyer was told to pay. Nullable only for admin-issued orders: `CHECK (source <> 'ONLINE' OR payment_account_id IS NOT NULL)` |
| hold_expires_at | timestamptz | see `04-manual-payment.md` hold policy. Nullable only for admin-issued orders: `CHECK (source <> 'ONLINE' OR hold_expires_at IS NOT NULL)` |
| first_proof_at | timestamptz | nullable |
| proof_attempts | integer | not null, default 0 — **total proof submissions made** (the first submission sets it to 1). Maximum is `1 + MAX_RESUBMISSIONS` = 4; attempts "remain" while `proof_attempts < 1 + MAX_RESUBMISSIONS` |
| inventory_released | boolean | not null, default false — true once reserved inventory has been returned to the tier; makes the sweep and reject paths idempotent |
| approved_at | timestamptz | nullable |
| approved_by | uuid | FK → staff_users.id, nullable |
| created_at / updated_at | timestamptz | default now() |

Indexes: `order_code` (unique), `(status, hold_expires_at)` for the sweep, `(status, first_proof_at)` for the admin queue, `customer_email`, `customer_phone` (abuse limits).

## `order_line_items`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | FK → orders.id, not null, on delete cascade |
| tier_id | uuid | FK → ticket_tiers.id, not null |
| quantity | integer | not null, > 0 |
| unit_price_kobo | integer | not null — price snapshot at checkout |
| holder_names | jsonb | nullable — array, length == quantity if present |

`ticket_units` (QR-bearing) are minted from these rows only inside `approveOrder`, never at checkout.

## `payment_accounts`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| bank_name | text | not null |
| account_number | text | not null |
| account_name | text | not null |
| is_active | boolean | not null, default false — partial unique index enforces at most one active row |
| created_by / updated_by | uuid | nullable FK → staff_users.id (null = created by the system seed) |
| created_at / updated_at | timestamptz | default now() |

## `payment_proofs`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | FK → orders.id, not null, on delete cascade |
| attempt_no | integer | not null — 1 for first submission |
| client_submission_id | text | not null — idempotency key; unique with `order_id` |
| storage_path | text | not null — private bucket path, never a public URL |
| file_sha256 | text | not null |
| mime_type | text | not null — detected from bytes |
| size_bytes | integer | not null |
| transfer_reference | text | not null — normalised (trim, uppercase, no spaces) |
| sender_name | text | not null |
| status | enum | `PENDING`, `APPROVED`, `REJECTED` |
| reject_reason_code | text | nullable — `UNREADABLE`, `AMOUNT_MISMATCH`, `NOT_RECEIVED`, `DUPLICATE_REFERENCE`, `CAPACITY_GONE`, `OTHER` |
| reject_message | text | nullable — shown to the buyer |
| reject_final | boolean | nullable |
| flags | jsonb | not null, default '{}' — e.g. `duplicate_image_of`, `late: true` (submitted after the hold expired, see `04`) |
| reviewed_by | uuid | FK → staff_users.id, nullable |
| reviewed_at | timestamptz | nullable |
| created_at | timestamptz | default now() |

Indexes: **partial unique index on `transfer_reference` WHERE `status IN ('PENDING','APPROVED')`** (a reference can be reused only after its earlier proof was rejected, and the admin UI surfaces that history); index on `file_sha256` (duplicate-image flag); `order_id`.

## `ticket_units`

The entity that gets scanned. One row per admittable ticket.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — internal ticket ID |
| order_id | uuid | FK → orders.id, not null, on delete cascade |
| event_id | uuid | FK → events.id, not null (denormalised for scan/manifest speed) |
| tier_id | uuid | FK → ticket_tiers.id, not null |
| holder_name | text | nullable |
| qr_token | text | unique, not null — Ed25519-signed token (see `05`) |
| check_in_status | enum | `NOT_CHECKED_IN`, `CHECKED_IN` — default `NOT_CHECKED_IN` |
| checked_in_at | timestamptz | nullable — the **effective** check-in time (earliest valid scan) |
| checked_in_by | uuid | FK → staff_users.id, nullable |
| voided_at | timestamptz | nullable — set on refund; voided tickets never validate |
| sync_seq | bigint | not null — from a global sequence, assigned by a `BEFORE INSERT OR UPDATE` trigger (`nextval`) so no code path can forget it: minting, check-in and voiding all bump it. Drives delta sync for the offline scanner. Sequence values are **not commit-ordered**, so delta sync must use an overlap window (see `03` manifest and `05`) |
| pdf_url | text | nullable — storage path, derived artifact |
| created_at | timestamptz | default now() |

Indexes: `qr_token` (unique), `order_id`, `(event_id, sync_seq)`.

## `check_in_scans` (append-only scan ledger)

Every scan attempt, online or offline-synced, valid or not.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| client_scan_id | text | unique, not null — generated on the device; makes batch sync idempotent |
| event_id | uuid | nullable |
| ticket_id | uuid | nullable (null when the token was invalid) |
| staff_user_id | uuid | FK → staff_users.id, not null |
| device_id | text | not null |
| scanned_at | timestamptz | not null — device time, corrected by the device's last measured clock offset |
| received_at | timestamptz | not null, default now() |
| offline | boolean | not null |
| result | enum | `VALID`, `DUPLICATE`, `INVALID`, `WRONG_EVENT`, `VOID`, `CONFLICT` |
| flags | jsonb | not null, default '{}' — e.g. `not_in_manifest: true` for an offline scan admitted on a valid signature for a ticket that was not on the device's list; the flag stays for admin review after the server resolves the result |

`CONFLICT` = two devices admitted the same ticket while offline; the earliest `scanned_at` keeps the effective check-in, the other scan is recorded as `CONFLICT` for admin review. No update/delete API exists.

## `staff_users`

Covers `OWNER` and `STAFF` — same table, different `role`.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| email | text | unique, not null |
| password_hash | text | not null |
| role | enum | `OWNER`, `STAFF` |
| invited_by | uuid | FK → staff_users.id, nullable |
| is_active | boolean | default true — deactivate, never delete |
| created_at | timestamptz | default now() |
| last_login_at | timestamptz | nullable |

## `push_subscriptions`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| staff_user_id | uuid | FK → staff_users.id, not null (`OWNER` only) |
| endpoint | text | unique, not null |
| p256dh / auth | text | not null |
| user_agent | text | nullable |
| is_active | boolean | default true |
| last_success_at | timestamptz | nullable |
| created_at | timestamptz | default now() |

## `audit_log_entries`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| actor_id | uuid | FK → staff_users.id, **nullable** (system events have no actor) |
| action | text | not null — e.g. `ORDER_APPROVED`, `ORDER_REJECTED`, `BANK_ACCOUNT_CHANGED`, `PROOF_DUPLICATE_REFERENCE_ATTEMPT`, `ORDER_REVIVED`, `ORDER_REFUNDED`, `TIER_PRICE_CHANGED`, `EVENT_CREATED` |
| entity_type | text | nullable |
| entity_id | uuid | **nullable** |
| metadata | jsonb | nullable — before/after values, context |
| created_at | timestamptz | default now() |

Append-only. Every financially significant admin action writes a row. Per-scan detail lives in `check_in_scans`; the admin audit view unions both.

## `email_jobs`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| order_id | uuid | FK → orders.id, not null |
| kind | enum | `PROOF_RECEIVED`, `TICKETS`, `REJECTED`, `STATUS_LINK` |
| dedupe_key | text | not null, default 'initial' — **unique with `(order_id, kind, dedupe_key)`**. `PROOF_RECEIVED` and the first `TICKETS` use `'initial'`; `REJECTED` uses `'attempt-<attempt_no>'` (so a second rejection is not swallowed); admin resends and `STATUS_LINK` jobs use a fresh key |
| recipient_email | text | not null |
| status | enum | `QUEUED`, `SENT`, `DELIVERED`, `BOUNCED`, `FAILED` |
| attempts | integer | default 0 |
| next_attempt_at | timestamptz | default now() |
| last_error | text | nullable |
| resend_message_id | text | nullable |
| created_at / updated_at | timestamptz | default now() |

Index: `(status, next_attempt_at)` — the worker's polling query.

---

## Inventory reservation mechanics

`ticket_tiers.reserved` solves the last-ticket race and the "gone at payment" problem. All conditional updates must be single atomic SQL statements (raw SQL via the ORM; ORM `where` clauses cannot express `capacity - sold - reserved >= n`), and the affected-row count is checked.

**On checkout initialize** (same transaction as the `orders` + `order_line_items` inserts; `hold_expires_at = now() + PROOF_SUBMIT_WINDOW`):
```sql
UPDATE ticket_tiers SET reserved = reserved + :n
WHERE id = :tier_id AND (capacity - sold - reserved) >= :n;   -- 0 rows = reject whole checkout (409)
```
Any line failing rolls back all lines. Prices come from `ticket_tiers.price_kobo`; validate event `PUBLISHED`, date confirmed, tier belongs to the event, sales window open, quantity within `MAX_QTY_PER_ORDER`.

**On approval** (`approveOrder`, see `04-manual-payment.md`): `sold = sold + n, reserved = reserved - n` per line item, inside the approval transaction.

**On expiry / final rejection** — one transaction, idempotent:
```sql
-- candidates locked so concurrent sweeps cannot double-release
SELECT id FROM orders
WHERE status IN ('AWAITING_PAYMENT','PROOF_SUBMITTED','NEEDS_RESUBMIT')
  AND hold_expires_at < now() AND NOT inventory_released
FOR UPDATE SKIP LOCKED;
-- for each: SET status='EXPIRED', inventory_released=true
--           and per line item: UPDATE ticket_tiers SET reserved = reserved - quantity WHERE id = tier_id
```
Final rejection (from `PROOF_SUBMITTED` or `NEEDS_RESUBMIT`) performs the same release for that one order; dismissing an already-`EXPIRED` order releases nothing (`inventory_released` is already true). The sweep also runs lazily at the start of `checkout/initialize`, so availability is right even if the scheduler is late. `hold_expires_at` for `PROOF_SUBMITTED` is `first_proof_at + HOLD_CAP` (48 h), so a submitted order is only swept at the cap, then handled by the revive path.

## State machines

Order status and hold policy: see `04-manual-payment.md` (authoritative).

**Ticket unit check-in:**
```
NOT_CHECKED_IN → CHECKED_IN   valid scan: UPDATE ... WHERE check_in_status='NOT_CHECKED_IN' AND voided_at IS NULL — row count decides the winner
CHECKED_IN     → CHECKED_IN   no-op; scan logged as DUPLICATE in check_in_scans
any            → voided       refund sets voided_at; voided tickets never validate
```
The check-in transition must be one atomic conditional UPDATE, never read-then-write, so two phones scanning at once cannot both win.
