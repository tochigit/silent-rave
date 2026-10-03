# 05. Ticketing, PDF Generation, QR Signing, and the Offline Scanner

## Orders vs. Ticket Units

An **order** is one checkout, one buyer email, one `order_code`, one payment approval. A **ticket unit** is one admittable ticket: one QR code, one scan, one person at the door. Example: 3 First Phase tickets in one checkout produce 1 `order`, 1 `order_line_item` (qty 3), and — **only after the owner approves** — 3 `ticket_units`, each with its own signed `qr_token`, and 1 ticket email carrying 3 PDFs (one per ticket, so each can be forwarded on its own).

## Named tickets (optional)

At checkout the buyer may label each ticket ("Me", "Chidi", "Amara"). Stored in `order_line_items.holder_names`, copied to `ticket_units.holder_name` at approval. The scanner shows the name so staff can eyeball-match it to ID: a deterrent, not cryptographic security.

## Ticket generation trigger

Tickets, QR tokens and PDFs exist only after `approveOrder` commits (`04-manual-payment.md`). Token minting happens **inside** the approval transaction (it is pure computation, no I/O). PDF generation and email sending happen afterwards in the email worker, never inside a DB transaction, and are regenerable from `ticket_units` + `events` + `ticket_tiers`.

## PDF ticket contents

Event name, date/time in Africa/Lagos (sales require a confirmed date, so this is always known), venue name and address, a **Get Directions** link (same `directions_url` as the event page: the ticket is what the buyer has open on the night), tier name, holder name if set, order code, the QR, Silent Rave branding. **One PDF per ticket unit.** Attach the PDFs to the email and also make them downloadable from the buyer's status page (`GET /api/orders/:code/status`), so tickets never depend on email delivery alone. PDFs are generated **on demand** by the download route and cached, so the buyer's page works before the email worker has run and a lost cache is harmless. The cache key includes a hash of everything rendered (event name, start time, venue name, address and place id, tier name, holder name, order code, QR token): storage key `tickets/<ticket_id>/<hash>.pdf`, with `ticket_units.pdf_url` pointing at the current key. If the stored key differs from the expected one the PDF is regenerated, so a changed venue or time is never served from a stale cache. If the event's date is unconfirmed at render time the PDF prints "Date to be announced" rather than failing. Use an embedded font with the glyphs needed (names with diacritics, the naira sign if a price is shown); standard PDF fonts are not enough. The QR is at least 40 mm square with a quiet zone, error correction level Q, black on white. The QR must render clearly at phone-screen size and survive a screenshot, since attendees may be offline at the gate.

## QR token — Ed25519 signature (replaces HMAC)

**Why not HMAC:** offline verification with HMAC would put the shared secret on every staff phone; one lost or compromised phone could forge valid tickets. With asymmetric signatures, phones hold only a **public** key: they can verify but never mint.

**Token format:**
```
qr_token = "1." + kid + "." + base64url(ticket_id_16B || event_id_16B) + "." + base64url(Ed25519_sign(private_key, "SR1" || ticket_id_16B || event_id_16B))
```
- `1` = format version; `kid` = short key identifier (supports rotation: several public keys may be valid at once).
- `event_id` is inside the signed payload so a device can reject a ticket for another event **even when it is not in the manifest**.
- ~135 characters, comfortable for a QR at medium error correction. Do not add more fields.
- Domain-separation prefix `SR1` is part of the signed message.

**Keys:** `TICKET_SIGNING_PRIVATE_KEY` (server-only) and `TICKET_SIGNING_KID` in env; a keygen script is provided; public keys are served in the manifest and embedded in the scanner. Rotation = add a new kid, keep old public keys valid until old tickets are irrelevant. Server code uses Node's built-in Ed25519. **The scanner uses a small audited pure-JS library** (e.g. `@noble/ed25519`) instead of relying on WebCrypto Ed25519, which is not uniformly supported on older phones.

**Verification order (server and device identical):** parse → check version and `kid` known → verify signature (constant-time inside the library) → check `event_id` → only then any lookup. Invalid signatures never touch the database.

## Scanner: online path

```
Scanner PWA (staff.silentrave.ng) selects tonight's event once at startup
   ↓ camera (getUserMedia) + client-side QR decode (jsQR/zxing) → token
POST /api/staff/check-in { token, event_id, device_id, client_scan_id }
   ↓ verify signature → wrong event? → { result: "wrong_event" }
   ↓ lookup ticket_unit by id; voided or order REFUNDED or event CANCELLED → { result: "void" }
   ↓ atomic: UPDATE ticket_units SET check_in_status='CHECKED_IN', checked_in_at=now(), checked_in_by=:staff
             WHERE id=:id AND check_in_status='NOT_CHECKED_IN' AND voided_at IS NULL
        1 row  → valid   ✅ show tier + holder name
        0 rows → duplicate ⚠️ "already scanned at [time] by [staff]"
   every attempt → check_in_scans row
```
All results return HTTP 200 with a `result` field. The transition is a single conditional UPDATE so two phones scanning the same ticket simultaneously cannot both get "valid".

## Scanner: offline mode (required for v1)

Step 4 operating rule: **use one offline scanner for the whole event during
an outage**. Multiple connected scanners use atomic server admission. Offline
refund/cancellation and other devices' admissions remain stale until sync.
See `07-owner-and-scanner-operations.md` for preparation and recovery.
The PWA caches only its generic shell/assets; admission data lives separately
in IndexedDB. A successful offline result follows durable outbox persistence.
Logout cannot silently discard unsynced evidence. Scanning expires at event end
or event-day grace, whichever comes first; pending evidence remains for sync.

Campus network is unreliable. The scanner must keep working with no signal and stay accurate.

**Prepare (online, before the event):** staff open the scanner while connected and tap **Prepare for event**. The PWA (service worker) caches itself so it loads offline, and downloads the manifest (`GET /api/staff/events/:id/manifest`) into IndexedDB: ticket id, tier, holder name, status, void flag, plus the public keys and `server_time`. The UI always shows manifest age, last successful sync, and pending-unsynced-scan count, and warns loudly if the device was never prepared. The device records `clock_offset_ms = server_time - device_time` at each sync.

**Offline scan:**
```
decode token → verify Ed25519 signature locally → event matches?
   invalid            → ❌ invalid
   wrong event        → ❌ wrong event
   in manifest, void  → ❌ void
   in manifest, not checked in locally → mark CHECKED_IN in IndexedDB, append to outbox → ✅ valid (shown with an "offline" badge)
   in manifest, already checked in (manifest or local) → ⚠️ duplicate, with time and who
   signature valid but NOT in manifest (approved after the last sync) → 🟠 "Valid signature, not on your list" — staff may admit; scan is flagged for review at sync
```
Each outbox entry has a device-generated `client_scan_id`, the token, and `scanned_at` (device time). Camera and QR decoding run entirely on the device.

**Sync:** whenever any connectivity appears (and on a manual **Sync now**), the outbox is POSTed to `/api/staff/check-in/batch`, idempotent per `client_scan_id`. The server applies scans in `scanned_at` order (adjusted by `clock_offset_ms`): the earliest scan for a ticket becomes the effective check-in; later scans of the same ticket by other devices are recorded as `CONFLICT`. The response returns a manifest delta (`since=<sync_seq>`) so the device learns about other gates' check-ins and new approvals. Sync failures retry with backoff and never drop outbox entries. The manifest delta uses an overlap window (`SYNC_OVERLAP`, see `03`) because `sync_seq` values are not commit-ordered; the device merges by ticket id and never lets a stale row un-check-in a ticket. An admitted-but-unlisted scan carries `flags.not_in_manifest` into `check_in_scans` and is resolved by the server normally (`VALID` or `CONFLICT`), with the flag kept for review.

**What "accurate" means, honestly:**
- **One device offline:** fully accurate.
- **Multiple gates offline at the same moment:** two phones can each admit the same ticket before either syncs. This is **detected after the fact and flagged, not prevented**. Mitigations: sync whenever a signal appears, one primary scanner per gate, a shared phone hotspot when possible, and admin review of `CONFLICT` scans. Do not present this to the client as prevented.
- A ticket refunded or voided after the last sync will still scan valid on an unsynced device; the sync flags it.

**Device data hygiene:** the manifest holds holder names and ticket ids only (no email, phone, or payment data). It is cleared on logout and when the event ends. **Offline session grace:** a scanner logged in and prepared while online keeps working offline for the event day even if the sliding session cannot refresh; it re-authenticates at the next sync, and a deactivated staff account is cut off at that point (and by the server on every online request).

## Abuse mitigation: what this does and does not solve

Fundamentally a **physical verification problem**: software reduces and detects misuse, it cannot replace a person matching the ticket to the bearer.

**Solved or reduced:**
- **Forgery:** without the private key, valid-looking tickets cannot be fabricated; phones hold only public keys, so a stolen scanner cannot mint tickets.
- **Reuse of one ticket:** one-way check-in state; the online path is atomic; offline conflicts are detected at sync.
- **Unauthorised scanning:** invite-only accounts, role checks on every request (`06`).
- **Accountability:** every scan (valid, duplicate, invalid, wrong-event, void, conflict) is in `check_in_scans` with staff, device, and time.
- **Fake payments** (not scanning, but the upstream weak point): see `04-manual-payment.md`; approval is the control.

**Not solved:** a staff member admitting friends, or scanning a screenshotted ticket before the real holder arrives, is a process/trust problem. The ledger makes it detectable afterwards and attributable, not preventable in the moment. Repeated duplicate/conflict patterns on one account are worth investigating; holder-name-to-ID checks and post-event review remain the real controls.
