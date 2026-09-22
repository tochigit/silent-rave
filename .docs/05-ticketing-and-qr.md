# 05. Ticketing, PDF Generation, and QR Scanning

## Orders vs. Ticket Units

An **order** is one checkout transaction, one email address, one Paystack reference. A **ticket unit** is one admittable ticket — one QR code, one scan, one person at the door. An order can (and often will) contain multiple ticket units.

Example: a customer buys 3 First Phase tickets for themselves and two friends in a single checkout. This produces:
- 1 `order` row
- 1 `order_line_item` row (tier: First Phase, quantity: 3)
- 3 `ticket_unit` rows, each with its own unique `qr_token`
- 1 email, sent to the checkout email, containing 3 PDF attachments (or one multi-page PDF)

The purchaser can forward individual ticket PDFs to their friends. Each is independently scannable and independently trackable at the door.

## Named tickets (optional, checkout-time feature)

At checkout, after selecting quantity, the purchaser is optionally shown one input per ticket unit: *"Who is this ticket for?"* (defaulting to blank or "Ticket 1 / Ticket 2 / Ticket 3" placeholders). This is stored as `holder_name` on the `ticket_units` row.

This serves two purposes:
1. **UX** — the purchaser can tell their tickets apart when forwarding them.
2. **Door-side fraud deterrent** — when a ticket is scanned, the scanner UI displays the holder name (if set) so staff can eyeball-match it against ID. This doesn't make check-in cryptographically secure (see Abuse Mitigation below) but raises the effort required to misuse a forwarded/shared ticket.

This field is optional at checkout — if left blank, the ticket is still valid, it just displays no name at scan time.

## PDF ticket generation

**Trigger:** only after `verifyAndFulfillOrder` confirms payment (see `04-paystack-integration.md`). Never generated at checkout submission time.

**Contents of each ticket PDF:**
- Event name, date, time, venue name and address
- A "Get Directions" link/button, built from the same `directions_url` used on the event detail page (see the Google Maps integration in `02-database-schema.md`/`03-api-routes.md`) — opens the device's native maps app for turn-by-turn navigation. This is worth including on the ticket itself, not just the event page: the ticket is the artifact a customer actually has open on the night of the event, often already heading out the door, so the directions link is more useful here than almost anywhere else in the flow. No new data or integration required — it's the same field already returned by the venue object, just also rendered into the PDF template.
- Ticket tier name (e.g. "First Phase")
- Holder name, if set
- The QR code (see below)
- Order reference (for support lookups)
- Silent Rave branding

**Format decision:** one PDF per ticket unit is the cleaner default (a customer forwarding "Chidi's ticket" sends exactly one self-contained file). A single multi-page PDF (one ticket per page) is the alternative if the client prefers one attachment per email regardless of quantity. **Recommendation: one PDF per ticket unit**, since the whole point of per-ticket QR codes is independent forwarding — bundling them into one PDF undercuts that. Confirm with client if this matters to them; default to one-PDF-per-ticket if not otherwise specified.

**Storage:** generated PDFs are stored in object storage (Supabase Storage / S3) and the URL recorded on `ticket_units.pdf_url`. Attach directly to the outgoing email (don't just link — customers expect PDF tickets in hand, and a link introduces an extra dependency on storage uptime for something that should be self-contained once delivered) or attach both, at implementer's discretion. Regeneration should be possible from `ticket_units` + `events` + `ticket_tiers` data alone, so the PDF itself is a derived artifact, not a source of truth — never stored data that can't be reconstructed.

## QR code payload — signing, not raw IDs

**Do not encode the raw `ticket_id` alone.** A raw sequential-feeling ID is enumerable/guessable, and even a random UUID alone can be screenshotted, shared, and re-verified without cryptographic proof it came from us.

**Payload structure:**
```
qr_token = base64url(ticket_id) + "." + HMAC-SHA256(ticket_id, TICKET_SIGNING_SECRET)
```
This value is generated once, at ticket-unit creation time (i.e., at payment confirmation), and stored verbatim in `ticket_units.qr_token`. The QR code image simply encodes this string.

**Verification on scan** (before touching the database):
```
1. Split the scanned string on "."
2. Recompute HMAC-SHA256(decoded_ticket_id, TICKET_SIGNING_SECRET)
3. Compare to the signature portion (constant-time comparison, not ==)
4. Mismatch → reject immediately as "❌ Invalid ticket" — no DB query needed
5. Match → proceed to look up ticket_id in the database
```
This ordering matters: rejecting invalid signatures **before** hitting the database means a flood of garbage/tampered QR attempts (e.g. someone trying to brute-force or fuzz ticket IDs) never touches the DB at all.

**Environment:** `TICKET_SIGNING_SECRET` — server-side only, never exposed to any client, rotatable only with a plan to re-issue all outstanding tickets (so in practice, treat it as effectively permanent for the life of the deployment, same operational caution as any long-lived signing key).

## Scanner flow (staff-facing)

**Implementation:** a web page on the staff subdomain, no native app. Uses `getUserMedia` for camera access and a JS QR-decoding library (`jsQR` or a `zxing` wrapper) running client-side to decode the QR into the raw token string, which is then sent to the backend for verification — the camera/decode step is purely client-side convenience, all trust decisions happen server-side.

```
Staff opens scanner page → camera permission → live camera feed
        ↓
QR decoded client-side → token string extracted
        ↓
POST /api/staff/check-in { token }
        ↓
Backend: verify HMAC signature (see above)
        ↓
   Invalid signature → 200 { result: "invalid" } → UI shows ❌ "Invalid ticket"
        ↓
   Valid signature → look up ticket_unit by ticket_id
        ↓
   Not found / wrong event for tonight's context → ❌ "Invalid ticket"
        ↓
   Found, check_in_status = NOT_CHECKED_IN
        → UPDATE: check_in_status = CHECKED_IN, checked_in_at = now(), checked_in_by = :staff_user_id
        → write audit_log_entries row (action: TICKET_CHECKED_IN)
        → 200 { result: "valid", tier_name, holder_name, event_name }
        → UI shows ✅ green, ticket type, holder name (for ID matching)
        ↓
   Found, check_in_status = CHECKED_IN already
        → do NOT change state (no-op on the second scan)
        → write audit_log_entries row (action: DUPLICATE_SCAN_ATTEMPT) — this is a signal for abuse pattern review
        → 200 { result: "duplicate", checked_in_at, checked_in_by_name }
        → UI shows ⚠️ amber, "Already scanned at [time] by [staff name]"
```

**Every branch returns HTTP 200** — the scan attempt itself always succeeded as a request; `result` in the body distinguishes valid/duplicate/invalid so the UI can render the right state without treating any of these as a server error.

## Check-in abuse: what this design does and does not solve

This is fundamentally a **physical verification problem** — software can reduce and detect misuse, not eliminate it, because the actual security boundary is "does the person standing at the door match the ticket." No amount of backend logic replaces a human glancing at a face and a screen.

**What this design solves:**
- **Ticket forgery/tampering** — the HMAC signature makes it computationally infeasible to fabricate a valid-looking QR code without the signing secret. Screenshots of *real* tickets are still cryptographically valid (that's unavoidable — they're photos of a real, signed credential), but fabricated ones are rejected instantly.
- **Duplicate/reuse of one ticket** — one-time-use enforcement (state transition is one-directional) means the second attempt to use a screenshotted or forwarded-then-also-kept ticket is flagged, not silently accepted.
- **Unauthorized scanner access** — invite-only staff accounts, role-gated at the API level (a customer or the public cannot reach the check-in endpoint's authenticated context at all without valid staff credentials).
- **Accountability for scan decisions** — `checked_in_by` on every ticket and a full audit log of every scan (valid, duplicate, and invalid attempts) means the admin can review patterns after the fact: a staff account with an unusual volume of duplicate-overrides, scans happening outside event hours, etc.

**What this design does not solve, and should not be oversold to the client as solving:**
- A staff member scanning their own screenshotted ticket, or letting a friend in on someone else's already-used-but-not-yet-scanned ticket before the real holder arrives, is a **process/trust problem**, not a software one. The audit log makes this *detectable after the fact* (attributed to a specific staff account, timestamped), not *prevented in the moment*.
- Mitigation beyond software: physical spot-checks (holder name ↔ ID matching, which the scanner UI supports by surfacing the name), management review of the audit log after events, and treating repeated duplicate-scan-attempt patterns tied to one staff account as a real signal worth investigating.

## Offline mode (stretch goal, not v1)

Venue wifi at Nigerian event spaces can be unreliable. If prioritized post-v1: the scanner page could cache a signed snapshot of that night's valid ticket tokens locally (service worker + IndexedDB), validate signatures offline, queue check-in state changes locally, and sync to the server on reconnect — with last-write-wins conflict resolution favoring "checked in" over "not checked in" to keep the one-time-use guarantee even across a sync gap. Not required for v1; flagging the shape of the solution so it isn't a surprise redesign later if requested.
