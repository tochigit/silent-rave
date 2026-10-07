# 04. Manual Bank-Transfer Payment, Proof Review, and Approval

**Status:** replaces `archive/04-paystack-integration.md` for v1. Decided with the client, knowing the trade-offs (edited-screenshot fraud, manual admin workload, buyers wait for a human).

## Principle

**Money is confirmed by a human checking the real bank account, never by the browser, and never by the uploaded image alone.** The screenshot is *evidence for the admin to check against the bank app*, not proof. Tickets, QR tokens and ticket emails exist only after an `OWNER` approves. Nothing is generated or sent on "I have paid".

## Buyer flow

```
Pick tier + qty + names → enter name, email (typed twice), phone
   ↓ POST /api/checkout/initialize
Order created AWAITING_PAYMENT, inventory soft-reserved (15 min to submit proof)
Screen shows: amount, order_code (SR-XXXXXX), bank details (from DB), copy buttons,
   instruction: "put SR-XXXXXX in the transfer narration"
   ↓ buyer transfers in their bank app, comes back
Buyer uploads receipt image + transfer reference (from receipt) + sender name
   ↓ POST /api/orders/:code/proof   ("I have paid")
Order → PROOF_SUBMITTED; hold no longer expires on the 15-min clock
Admin notified (web push + live queue); buyer gets "we received your proof" email
   ↓ OWNER reviews
 APPROVE → APPROVED → tickets minted → ticket email queued
 REJECT (resubmittable) → NEEDS_RESUBMIT → buyer re-uploads (max 3 re-uploads)
 REJECT (final) → REJECTED → inventory released
```

The buyer's status page (`/order/:code?t=<status_token>`) shows the current state, the rejection reason if any, a re-upload form when `NEEDS_RESUBMIT`, and ticket downloads once `APPROVED`. It must work as the fallback if the email never arrives.

## Order states

```
AWAITING_PAYMENT → PROOF_SUBMITTED     (buyer submitted proof)
AWAITING_PAYMENT → EXPIRED             (15 min lapsed with no proof; sweep releases inventory)
PROOF_SUBMITTED  → APPROVED            (OWNER approves)
PROOF_SUBMITTED  → NEEDS_RESUBMIT      (OWNER rejects, resubmittable)
PROOF_SUBMITTED  → REJECTED            (OWNER rejects, final)
NEEDS_RESUBMIT   → PROOF_SUBMITTED     (buyer re-uploads; proof_attempts += 1)
NEEDS_RESUBMIT   → REJECTED            (attempts exhausted, or OWNER closes it; releases inventory)
NEEDS_RESUBMIT / PROOF_SUBMITTED → EXPIRED   (48h hold cap, see below)
EXPIRED          → EXPIRED             (a late proof is recorded, once; see "Late proofs")
EXPIRED          → APPROVED            (OWNER "revive & approve": needs a PENDING proof and capacity that can be re-reserved atomically)
EXPIRED          → REJECTED            (OWNER dismisses an expired order that has a PENDING proof; releases nothing)
APPROVED         → REFUNDED            (manual, voids tickets)
```
No other transitions. `REJECTED` and `REFUNDED` are terminal. Every transition writes an audit entry with the actor.

## Hold policy (locked)

| Constant | Value |
|---|---|
| `PROOF_SUBMIT_WINDOW` | 15 minutes from order creation |
| `HOLD_CAP` | 48 hours from **first** proof submission; not reset by re-uploads |
| `MAX_RESUBMISSIONS` | 3 re-uploads after resubmittable rejections (4 total submissions) |
| `MAX_QTY_PER_ORDER` | 10 |
| `LATE_PROOF_GRACE` | 24 hours after `hold_expires_at`, for an order that expired with **no** proof (see "Late proofs") |

- `orders.hold_expires_at` is `created_at + 15 min` while `AWAITING_PAYMENT`; on the first proof submission it becomes `first_proof_at + 48h` and is never extended. The sweep therefore covers `AWAITING_PAYMENT` (15-minute hold) and `PROOF_SUBMITTED` / `NEEDS_RESUBMIT` (48 h cap); the SQL in `02` is authoritative.
- At the cap the sweep sets `EXPIRED` and releases inventory (`inventory_released = true`). **A buyer may have really paid**, so an expired order with a `PENDING` proof (it expired while awaiting review, or received a late proof) stays visible in the admin queue under "Expired — had proof", and the admin can **revive & approve** it (which approves that `PENDING` proof): inside one transaction, atomically re-reserve each line item (`UPDATE ... WHERE capacity - sold - reserved >= n`); if any tier lacks capacity, roll back and tell the admin plainly so he can refund manually. Never silently lose a payment. An order that expired from `NEEDS_RESUBMIT` has no `PENDING` proof (the owner already rejected its last proof) and is **not revivable**; if that buyer turns up, the owner uses the admin-issued path (`03`). The owner can also **dismiss** an expired-with-proof order (reject, always final) when the buyer was refunded or the case is closed.
- Approaching the cap (e.g. 6 h left) an order shows as urgent in the queue.
- Reject reasons: the admin picks a code (`UNREADABLE`, `AMOUNT_MISMATCH`, `NOT_RECEIVED`, `DUPLICATE_REFERENCE`, `OTHER`) plus a message to the buyer, and a `final` flag. `NOT_RECEIVED` and suspected fraud are normally final.
- Abuse limits: max 2 concurrent unresolved orders (`AWAITING_PAYMENT`, `PROOF_SUBMITTED`, `NEEDS_RESUBMIT`) per email and per phone. **Not a per-IP cap**: campus users share NAT addresses and would block each other, so IP is a rate limit only (configurable, default 10 initialize requests per hour per IP), alongside rate limits on the proof and lookup endpoints. Limiter state location must be documented (in-memory is per-instance; note the caveat).

## Proof submission contract

Fields: `proof image`, `transfer_reference` (required — the transaction/session ID printed on the bank receipt), `sender_name` (required), `client_submission_id` (idempotency key so a flaky-network retry never creates a second attempt).

Server-side handling:
1. Validate the order exists and that either (a) status is `AWAITING_PAYMENT` or `NEEDS_RESUBMIT` and the hold has not expired, or (b) status is `EXPIRED` with **no** proof yet and `now() <= hold_expires_at + LATE_PROOF_GRACE` (a *late proof*); and attempts are not exhausted (`proof_attempts < 1 + MAX_RESUBMISSIONS`, else `403`).
2. Validate file by **magic bytes**, not the client MIME: JPEG/PNG/WebP only (HEIC from iPhones must be converted locally before upload), at most 3 MiB after browser preparation, within a bounded 3.25 MiB multipart envelope. Check sane pixels; orient/re-encode and strip EXIF/GPS; bound stored output to 3 MiB. Compute `file_sha256` of the original upload. Record stored-byte hash/size separately in storage accounting. See [Batch A](10-uploads-durable-storage.md).
3. Normalise `transfer_reference` (trim, uppercase, strip spaces) and enforce **uniqueness among proofs whose status is `PENDING` or `APPROVED`** at the DB level (partial unique index). A collision returns a clear buyer-facing error and writes an audit entry.
4. If `file_sha256` matches a proof on a *different* order, do not block; set `flags.duplicate_image_of = <proof id>` so the admin sees it prominently.
5. Store the image in a **private** bucket. Never public, never a guessable URL.
6. Transaction: insert `payment_proofs` row, set order `PROOF_SUBMITTED`, set/keep `hold_expires_at`, increment `proof_attempts` on every submission (first = 1), enqueue `PROOF_RECEIVED` email job (first submission only), emit realtime event and web push (no PII in either).

**Late proofs.** A buyer on a slow bank app or weak network may pay after the 15-minute window. A proof arriving after expiry but within `LATE_PROOF_GRACE` is **recorded, not rejected**: the `payment_proofs` row is inserted `PENDING` with `flags.late = true`, `first_proof_at` and `proof_attempts = 1` are set, the order **stays `EXPIRED`**, no inventory is touched, `hold_expires_at` is unchanged, and `PROOF_RECEIVED` is queued. It then appears in the queue as "Expired — had proof" and follows the revive-or-dismiss path (a late proof can only be approved via revive, which re-reserves capacity atomically). The status page tells the buyer plainly: the proof arrived after the reservation lapsed, the owner will check it, and if the tickets sold out in the meantime they will be refunded. Only one late proof per order; after the grace window the endpoint returns `410`. Transfer-reference uniqueness applies as normal.

Client-side (spec for the front-end phase, listed here because it shapes the API): compress the photo in the browser before upload, show progress, allow retry with the same `client_submission_id`, and keep form state through a failed attempt. Campus network is weak but not absent.

## Admin review

The queue lists `PROOF_SUBMITTED` oldest first, then `Expired — had proof`. Each review screen shows, together: order code, buyer name/email/phone, tier and quantity, **expected amount**, time submitted, attempt number, entered transfer reference and sender name, the proof image (short-lived signed URL, 60–120 s, `OWNER` only), and flags (duplicate image, reused reference, prior rejected attempts).

**Approve** requires an explicit `confirmed_in_bank: true` (the UI phrases it as "I checked the credit in the bank app"). The amount is not editable: if the buyer paid the wrong amount, reject with `AMOUNT_MISMATCH`.

### `approveOrder(orderId, actor)` — idempotent, atomic

```
1. Short transaction:
   SELECT ... FROM orders WHERE id = :id FOR UPDATE
   status = APPROVED            → return existing result (idempotent no-op)
   status = PROOF_SUBMITTED     → proceed
   status = EXPIRED (has a PENDING proof) → attempt atomic re-reserve; on failure roll back, return CAPACITY_GONE
   any other status             → reject with a clear error
   event is CANCELLED           → reject with EVENT_CANCELLED (checked after the lock, before any inventory change)
2. For each line item: UPDATE ticket_tiers SET sold = sold + n, reserved = reserved - n
   (revive path: reserved untouched, sold + n guarded by capacity check instead)
3. Mint ticket_units (one per ticket, signed qr_token — see 05), copy holder_names
4. orders: status APPROVED, approved_at, approved_by; the PENDING proof: status APPROVED
5. Insert email_jobs (kind = TICKETS) — unique per (order, kind, 'initial')
6. Insert audit_log_entries (`ORDER_APPROVED`; `ORDER_REVIVED` on the revive path, see `06`)
   COMMIT
7. After commit: emit realtime event. PDF generation and sending happen in the worker, never inside this transaction.
```
Two admins tapping approve at once, or a double-click, must yield exactly one transition, one set of ticket units, one email job.

`rejectOrder(orderId, actor, reason_code, message, final)`: locks the order, then acts by source state.
- `PROOF_SUBMITTED` (its `PENDING` proof becomes `REJECTED`): resubmittable and attempts remain (`proof_attempts < 1 + MAX_RESUBMISSIONS`) → `NEEDS_RESUBMIT`; otherwise → `REJECTED`, with `inventory_released` set and `reserved` decremented in the same transaction.
- `NEEDS_RESUBMIT`: the owner closes it → `REJECTED` (final), releasing inventory if not already released.
- `EXPIRED` with a `PENDING` proof: dismiss → `REJECTED`, proof `REJECTED`; always final; nothing to release. `CAPACITY_GONE` is the usual reason after a failed revive.
- Any other state → clear error.

Queues a `REJECTED` email (dedupe key `attempt-<attempt_no>`; a fresh key for the close/dismiss cases) carrying the reason and, when resubmittable, the re-upload link. Audit-logged.

## Emails (Resend, DB-queued — see `02`, `03`)

| kind | Trigger | Content |
|---|---|---|
| `PROOF_RECEIVED` | first proof submitted | order code, "we are checking", status link. **No ticket.** |
| `TICKETS` | `approveOrder` commits | order summary + one PDF per ticket, status/download link |
| `REJECTED` | `rejectOrder` | reason, whether they can re-upload, link |
| `STATUS_LINK` | `POST /api/orders/lookup` matched code + email | the buyer's status link only; no order details in the body |

Every status link in every email is **derived** at send time (`02`, `orders.status_token_version`), so the worker never needs a stored token. Dedupe keys are listed in `02` (`REJECTED` = `attempt-<n>`; resends and `STATUS_LINK` = fresh keys).

**A ticket email is only ever queued by `approveOrder`.** Admin "resend tickets" creates a new job with a new dedupe key and is audit-logged. The buyer's status page must still show/download tickets independently of email.

## Email worker

- **Claiming.** Jobs are claimed in a short transaction with `FOR UPDATE SKIP LOCKED`: select `QUEUED` rows with `next_attempt_at <= now()`, then push `next_attempt_at` forward by a lease (default 5 minutes) and increment `attempts`. Sending happens **after** that transaction commits. A worker that dies mid-send simply lets the lease expire and the job is retried.
- **Idempotent send.** Every provider call carries an idempotency key equal to the job id, so a retry after an unknown outcome (crash after the provider accepted, timeout) does not send twice. The provider's message id is stored right after the send; the job id is also sent as a provider tag so webhooks can match even if they arrive before the id is stored.
- **Outcomes.** Success → `SENT` with `resend_message_id`. Transient (network error, timeout, 5xx, 429 honouring `Retry-After`, daily quota exceeded) → stay `QUEUED` with backoff (default 1 min, 5 min, 30 min, 2 h, 6 h, with jitter) and the batch pauses on quota errors. Permanent (other 4xx) → `FAILED` at once. After `MAX_EMAIL_ATTEMPTS` (default 6) → `FAILED`. `last_error` holds a short sanitised reason, never a link, token or address.
- **Throttle.** The provider limits request rate (2 requests per second by default on Resend), so the worker spaces sends (`EMAIL_SEND_INTERVAL_MS`, default 600) and caps a batch (default 20 jobs per run).
- **Send-time checks.** A `TICKETS` job whose order is no longer `APPROVED` (refunded in the meantime) is `FAILED` with reason `ORDER_NOT_APPROVED` and sends nothing. Recipients always come from `orders.customer_email`.
- **Content.** React Email templates with a plain-text alternative; buyer-supplied text is escaped; the subject never contains buyer input; bank details are never emailed. `TICKETS` attaches one PDF per ticket named `SilentRave-<order_code>-<n>.pdf` (no holder names in file names).
- **Webhook.** `POST /api/webhooks/resend` verifies the signature over the raw body (secret `RESEND_WEBHOOK_SECRET`, replay window 5 minutes), caps the body size, and applies `delivered`/`bounced` monotonically: `BOUNCED` and `DELIVERED` are never downgraded to `SENT`, `BOUNCED` is never overwritten, replays are no-ops. An event that matches no job returns `404` so the provider retries (the event may have beaten the stored message id); unknown event types return `200`.
- **Running it.** `POST /api/internal/process-email-jobs` (`CRON_SECRET`) drains a batch; it is also kicked best-effort after the commit that queued a job (never inside the transaction, failures swallowed). The final host's scheduler must call it at least every minute; that is a pre-launch item.

## Payment accounts (bank details live in the DB)

Never hardcoded in the front end. `payment_accounts` holds bank name, account number, account name, `is_active`. Exactly one active row is shown to buyers. Each order records `payment_account_id` at creation so the account it told the buyer to pay stays traceable after a change. Changing or activating an account is `OWNER`-only, requires password re-entry, and writes `BANK_ACCOUNT_CHANGED` to the audit log with before/after. (A swapped account number is the classic scam; treat this as a sensitive action.)

## Notifications and realtime

- **Web Push (VAPID)** to subscribed `OWNER` devices when a proof arrives or a resubmission comes in. Payload carries no PII: order code and a deep link only. Subscriptions live in `push_subscriptions`; expired endpoints (410/404) are deactivated. The admin panel shows a visible banner if the owner has no active subscription. Note for the client: on iPhone, web push only works after the admin site is added to the Home Screen (iOS 16.4+).
- **Realtime is a convenience layer, not the source of truth.** After each commit the server emits small events (`order.proof_submitted`, `order.approved`, `order.rejected`, …) carrying IDs only; clients refetch through the authenticated API. Transport: Supabase Realtime broadcast where available. **Clients must also poll** as a fallback (admin queue every 10–15 s while visible; buyer status page every 5–10 s while non-terminal, with backoff). A dropped socket must never hide a pending payment.

## Refunds (manual, v1)

`POST /api/admin/orders/:id/refund` — status-only: `REFUNDED`, all its `ticket_units` get `voided_at`, optional `restock` flag decrements `sold`. Money is returned by the owner from his bank app. The call is idempotent and race-safe (row lock; a second or concurrent call never restocks twice). `restock` decrements `sold` by the order's line quantities (never below zero), defaults to false, and is meant only while the event is still on sale. Refunding an order with an already-checked-in ticket needs an explicit acknowledgement (`03`). A refunded order's ticket PDFs stop downloading (`410`), and a queued `TICKETS` email that has not been sent is not sent. Voided tickets scan as invalid (online) and appear as void in the next offline manifest sync.

## Not in this doc

Ticket/QR format and scanner: `05`. Schema: `02`. Routes: `03`. Roles: `06`. A future Paystack rail would implement the same `approveOrder` internals behind a payment-adapter interface; nothing here blocks that.
