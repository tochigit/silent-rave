# Changelog

## v2.1.2 (Phase 4 specification)

1. **Uniform 404 on order routes (`03`).** Unknown code, wrong token and missing token are indistinguishable on the proof, status and PDF routes (matches the Phase 3 build).
2. **PDF route (`03`, `05`).** New `GET /api/orders/:code/tickets/:ticketId/pdf` with defined error codes; cache key includes a hash of the rendered inputs so stale PDFs are never served; unconfirmed-date and font requirements.
3. **Email worker (`04`, `03`).** Claiming with a lease, idempotency key, retry/backoff and quota handling, throttle, send-time checks, content rules, webhook rules (monotonic, raw body, replay window), invocation endpoint `POST /api/internal/process-email-jobs`.
4. **Refunds (`03`, `04`).** Only from `APPROVED`, idempotent, `restock` semantics, acknowledgement for checked-in tickets, PDFs stop downloading, unsent `TICKETS` job is not sent.
5. **Resend-tickets (`03`).** `APPROVED` only, rate limited, recipient fixed, audited as `TICKET_RESENT`.
6. **Owner visibility of email failures (`03`).** `GET /api/admin/email-jobs` plus email jobs in order detail.
7. **Referrer policy (`06`).** Pages carrying the status token must send `Referrer-Policy: no-referrer`.

## v2.1.1 (patches from the Phase 3 report)

Docs only; GLM's Phase 3 build already matches items 2-5. Item 1 needs a small code change.

1. **Initialize rejects ended events (`03`).** The validation list now includes `ends_at > now()`. Without it a past, date-confirmed event with an open sales window stayed purchasable.
2. **Revive audit action (`04`).** `ORDER_REVIVED` on the revive path, `ORDER_APPROVED` otherwise (matches `06`).
3. **Sweep scope (`04`).** Prose now says the sweep covers the 15-minute hold and the 48 h cap; `02` SQL authoritative.
4. **HEIC (`04`).** Server accepts JPEG/PNG/WebP only; HEIC is converted client-side.
5. **`payment_accounts.created_by/updated_by` (`02`).** Nullable (null = system seed).

## v2.1 (patches from the v2 review)

Each item names the docs changed. Items 1-6 affect Phase 3.

1. **Late proofs (`04`, `03`, `01`).** A proof arriving after the 15-minute window is no longer refused with `410` outright. Within `LATE_PROOF_GRACE` (24 h after expiry) it is recorded `PENDING` with `flags.late`, the order stays `EXPIRED`, and it lands in "Expired — had proof". Revive-or-dismiss handles it. Real payments are never silently lost.
2. **Owner can close every order (`04`, `03`).** `rejectOrder` now works from `PROOF_SUBMITTED`, `NEEDS_RESUBMIT` (close) and `EXPIRED` with a `PENDING` proof (dismiss, always final). New reject code `CAPACITY_GONE`.
3. **Email uniqueness (`02`, `04`).** `email_jobs` is unique on `(order_id, kind, dedupe_key)`. `REJECTED` uses `attempt-<n>`. New kind `STATUS_LINK`.
4. **Revive rules (`04`).** Only an `EXPIRED` order with a `PENDING` proof is revivable; that proof becomes `APPROVED`. Orders that expired from `NEEDS_RESUBMIT` are not revivable. `approveOrder` rejects `CANCELLED` events (`EVENT_CANCELLED`).
5. **IP limit (`04`, `03`).** Unresolved-order cap is per email and per phone only. IP is a rate limit (shared campus NAT).
6. **Status link and lookup (`02`, `03`, `04`, `06`).** The status token is now **derived** (`HMAC(STATUS_TOKEN_SECRET, order_id:version)`), replacing `status_token_hash`. Reason: the email worker must put the link in emails but the raw token was never stored, which v2 could not do. `orders/lookup` always returns `202` and only emails a link; it never returns order data.
7. **Delta sync (`02`, `03`, `05`).** `sync_seq` is assigned by a trigger on every insert/update, and manifest deltas use an overlap window (`SYNC_OVERLAP`) because sequence values are not commit-ordered.
8. **Unlisted offline scans (`02`, `03`, `05`).** New `check_in_scans.flags` (`not_in_manifest`).
9. **Buy Tickets with an unconfirmed date (`01`, `03`).** Confirmed future events first, then unconfirmed published events, then the empty state.
10. **Maps key honesty (`02`, `03`, `01`).** The key in an iframe `src` is visible; protection is restriction to the Embed API and HTTP referrers. `directions_url` prefers `query_place_id`. New open decision for the client's Google Cloud key.
11. **Nitro leftovers removed from examples (`03`).**
12. **PDFs on demand (`03`, `05`).** Download route generates and caches PDFs, so the status page works before the worker runs.
13. **Admin-issued orders (`02`).** `customer_phone`, `payment_account_id`, `hold_expires_at` are nullable with CHECKs that keep them required for `ONLINE` orders.
14. **`proof_attempts` semantics (`02`, `04`).** Counts total submissions (first = 1); attempts remain while `< 1 + MAX_RESUBMISSIONS`.
15. Cosmetic clean-up in `02`.
