> **ARCHIVED — NOT IN v1.** Superseded by `../04-manual-payment.md`. Kept only as the reference shape for a future Paystack adapter behind the payment-adapter interface. Do not implement from this file.

# 04. Paystack Integration Contract

## Principle

**Never fulfill an order, generate tickets, or send email based solely on the browser reporting success.** The frontend "success" callback is a *hint* to check, not a source of truth. The only authoritative source of truth is a server-to-server call to Paystack's verify endpoint.

## Full flow

```
Customer completes payment on Paystack's hosted page
        ↓
   ┌────┴─────────────────────┐
   ↓                           ↓
Frontend success callback   Paystack webhook (POST /api/webhooks/paystack)
   ↓                           ↓
POST /api/checkout/verify   verify HMAC signature (x-paystack-signature header)
   ↓                           ↓
   └────── both call verifyAndFulfillOrder(reference) ──────┘
                      ↓
        GET https://api.paystack.co/transaction/verify/:reference
        (server-to-server, authoritative — this is the only call that matters)
                      ↓
        status === 'success'
        AND amount === order.total_kobo  (compare against what WE expected, not what Paystack echoes back as "requested")
        AND currency === 'NGN'
                      ↓
        All true?
                      ↓
        BEGIN TRANSACTION
          - Re-check order.status — if already PAID, return early (idempotent no-op)
          - UPDATE orders SET status = 'PAID', paid_at = now(), paystack_transaction_id = :id
          - For each order_line_item: UPDATE ticket_tiers SET sold += qty, reserved -= qty
          - Generate ticket_units rows (QR tokens minted here — see 05-ticketing-and-qr.md)
          - Generate PDF(s)
          - Enqueue email_jobs row
        COMMIT
                      ↓
        Return order confirmation to whichever caller (frontend or webhook) triggered this
```

## Why both paths call the same function

- **Frontend callback path** gives the customer instant feedback (fastest UX — they see confirmation within a second or two of paying).
- **Webhook path** is the safety net for cases where the customer closes the tab, loses connection, or the frontend call fails before completing — Paystack's webhook will still arrive and independently trigger fulfillment.
- Both call the **exact same idempotent function**, keyed on `reference`. This is not two features — it's one fulfillment path with two triggers, which is why idempotency is not optional.

## `verifyAndFulfillOrder(reference)` — idempotency contract

This function **must** be safe to call multiple times concurrently for the same reference (webhook retries are common — Paystack retries on non-2xx responses, and network conditions can cause duplicate deliveries).

Implementation requirements:
1. Acquire a row lock on the `orders` row for `paystack_reference = :reference` (`SELECT ... FOR UPDATE`) before checking status.
2. If `order.status === 'PAID'` already, return the existing confirmation immediately — do not re-verify with Paystack, do not re-decrement inventory, do not re-send email. This is the idempotency guard.
3. Only if `order.status === 'PENDING'` do the full verify-and-fulfill sequence.
4. If Paystack verify returns anything other than `success` (e.g. `failed`, `abandoned`), mark the order `FAILED` and release the reserved inventory — do not leave it dangling in `PENDING` until the TTL sweep catches it.

## Webhook endpoint contract

**Route:** `POST /api/webhooks/paystack`

**Security — mandatory before any processing:**
```
1. Read raw request body (do not parse JSON before verifying — signature is computed over the raw bytes)
2. Compute HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)
3. Compare to the `x-paystack-signature` header
4. Mismatch → reject with 401, log the attempt, do NOT process
5. Match → proceed to parse and handle
```
This check exists because the webhook URL is, by necessity, a public endpoint. Without signature verification, anyone who discovers the URL could POST a fake "charge.success" event and get free tickets fulfilled.

**Event types to handle:**
- `charge.success` → call `verifyAndFulfillOrder(event.data.reference)`
- Other event types (e.g. `transfer.success`, if ever used for payouts) → acknowledge with 200 but no-op for v1; we don't use transfers.

**Response contract:** always return `200` quickly once the signature check and the enqueue/handling is done, even if fulfillment itself is deferred to a background step — Paystack will retry on non-2xx or timeout, which is fine given idempotency, but slow webhook responses can cause unnecessary retries and pile-up.

## Frontend verify endpoint contract

**Route:** `POST /api/checkout/verify`

**Request body:** `{ reference: string }`

**Behavior:** calls the same `verifyAndFulfillOrder(reference)`. Returns the order status to the frontend so it can render a confirmation screen (or a "still processing, check your email" state if, for some reason, the webhook beats it or verification is momentarily inconclusive).

**Important:** this endpoint does **not** trust anything the frontend claims about payment status — it takes only the `reference` string (which is not a secret; it's already visible in the Paystack redirect URL) and independently re-verifies with Paystack. A malicious client sending an arbitrary reference they don't own simply gets "not found" or "not your order" — it cannot be used to fulfill someone else's order or fabricate a payment.

## Amount and currency verification detail

This is a specific, easy-to-skip check: verify **`data.amount` from Paystack's response equals `order.total_kobo`** (both in kobo), not just that `data.status === 'success'`. Also verify `data.currency === 'NGN'`.

Why this matters: without this check, a bug or deliberate tampering on the client side (e.g. altering the amount sent to Paystack's initialize call) could result in a customer paying ₦100 for a ₦5,200 ticket, and the webhook would still report `success` — because ₦100 *was* successfully paid — and your system would happily fulfill the full order if it only checks status.

## Initializing a transaction

**Route:** `POST /api/checkout/initialize`

Server-side call to `POST https://api.paystack.co/transaction/initialize` with:
```json
{
  "email": "<customer_email>",
  "amount": "<order.total_kobo>",
  "reference": "<our generated unique reference, stored on the order row before this call>",
  "currency": "NGN",
  "callback_url": "https://silentrave.ng/checkout/callback"
}
```
The reference is generated by **us**, stored on the `orders` row first, then passed to Paystack — this is what makes `verifyAndFulfillOrder` able to look up the correct order from Paystack's response/webhook.

## Environment / secrets

| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Server-side only — used for initialize, verify, and webhook signature check |
| `PAYSTACK_PUBLIC_KEY` | Client-side, safe to expose — used if inline Paystack popup is used instead of redirect |
| `PAYSTACK_WEBHOOK_URL` | Registered in the Paystack dashboard, not an app secret, but document it here for deployment checklists |

Never log `PAYSTACK_SECRET_KEY`. Never expose it to the client bundle.

## Failure and edge cases to handle explicitly

| Scenario | Handling |
|---|---|
| Customer abandons payment (never completes on Paystack's page) | Order stays `PENDING`, expires naturally via the reservation TTL sweep (`02-database-schema.md`) |
| Paystack reports `failed` explicitly | `verifyAndFulfillOrder` marks order `FAILED` immediately, releases reserved inventory, does not wait for TTL |
| Webhook arrives before frontend callback | Fine — idempotent function handles it, frontend verify call will find `PAID` already and short-circuit |
| Webhook arrives twice (Paystack retry) | Idempotency guard (step 2 above) makes the second call a no-op |
| Customer's card is charged but Paystack's API is briefly down when we try to verify | Do not fulfill on a failed verify call — retry the verify call (with backoff) rather than trusting an unverified "success." The webhook, once it eventually lands, is the safety net here too. |
| Amount mismatch (tampered client-side amount) | Reject fulfillment even if `status === success`; log as a suspicious event in `audit_log_entries` |
