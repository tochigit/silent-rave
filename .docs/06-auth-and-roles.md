# 06. Auth, Roles, and Subdomain Separation

## Roles

Two roles, one `staff_users` table (see `02-database-schema.md`):

| Role | Access |
|---|---|
| `OWNER` | Everything: events, venues, organizers, tiers, pricing, **payment review (approve/reject/revive), bank accounts, refunds, admin-issued tickets, reconciliation**, push subscriptions, staff accounts, audit log. **Only OWNER can approve payments.** |
| `STAFF` | Scanner endpoints only: event list, offline manifest, check-in, batch sync, and the read-only attendee list. No pricing, no orders, no payments, no proofs, no bank details, no buyer email/phone, no editing. |

There is no public/customer authentication in v1 — customers check out as guests (name, email and phone at checkout, no account creation). Guests reach their own order only through the unguessable `status_token` link, or by requesting a fresh link through the rate-limited order-code + email lookup, which emails the link and never returns order data (`03`). The link token is derived from `STATUS_TOKEN_SECRET` (`02`), so that secret is a server-only environment variable like the ticket signing key. Because the token travels in the query string of the status link, every page and route that carries it must send `Referrer-Policy: no-referrer` and load no third-party resources. This matches the reference site's behavior and keeps checkout friction low, which matters for a mobile-first, impulse-purchase-driven ticketing flow.

## Subdomain architecture

- `silentrave.ng` (or the final domain) — public customer-facing site
- `admin.silentrave.ng` — owner dashboard
- `staff.silentrave.ng` — scanner / check-in interface

**One codebase, one database, shared backend.** The subdomains are different Next.js route groups (or separate frontend entry points, depending on final routing decision) hitting the same API. This is not three separate applications — it's one application with three audiences.

**Routing:** in Next.js 16 this is `proxy.ts` (formerly `middleware.ts`). It inspects the `host` header and rewrites to the appropriate route group (`/admin/*`, `/staff/*`, or the public site). The final domain is not fixed yet: hostnames must come from configuration, not hardcoded `silentrave.ng`.

**Session cookie scope:** the session cookie must be set with `Domain=.silentrave.ng` (leading dot, root-domain scope) so a session established on one subdomain is recognized appropriately across the others where relevant — though in practice, admin and staff sessions should remain **functionally separate**: logging into `admin.silentrave.ng` should not grant scanner access on `staff.silentrave.ng` without the account actually holding appropriate role, and vice versa. The shared cookie domain is a deployment/infra convenience, not a statement that the two panels trust each other's sessions blindly — every request is still role-checked server-side regardless of where the cookie came from.

## Server-side enforcement — the non-negotiable part

**Every API endpoint that touches admin or staff functionality checks the authenticated user's role on the server, on every request.** This is not optional and is not satisfied by hiding buttons in the UI.

```
Proxy / route handler pattern:

1. Extract session from cookie
2. No valid session → 401
3. Valid session, but role does not match what this endpoint requires → 403
4. Role matches → proceed
```

Concretely: if a `STAFF` role account somehow sends a request to `GET /api/admin/orders` (e.g. by guessing the URL, inspecting network traffic, or a compromised staff device), the server must return `403 Forbidden` — the fact that the staff subdomain's UI never shows a link to that endpoint is irrelevant to whether the endpoint itself is protected. Treat every admin-only and staff-only route as though a hostile actor already has the URL.

## CSRF and Origin checks

The session cookie is scoped to the root domain, so `SameSite=Lax` does **not** separate `admin.` from `staff.` or the public site (they are same-site). Every state-changing admin and staff request (`POST/PATCH/PUT/DELETE`) must verify that the `Origin` header matches the expected host for that surface and reject otherwise. Sensitive owner actions (changing bank details, refunds) additionally require password re-entry.

## Offline scanner session

Step 4 enforces temporary-password replacement: newly invited STAFF must use
`/staff/password` and `POST /api/auth/password` before protected APIs work.
The request verifies the current password and surface Origin, rate limits,
requires a different 12–72 character password, and revokes other sessions.
Existing OWNER credentials are unchanged. No public registration is added.

A staff device that logged in and prepared the event while online may keep scanning offline for that event day with a locally held session grace (no server refresh needed); it re-authenticates at the next sync. Deactivation (`is_active = false`) takes effect on the next online request or sync. Logout clears the manifest and outbox handling rules in `05-ticketing-and-qr.md`.

## Account creation — invite-only, no public signup

- No public registration path exists for `admin.silentrave.ng` or `staff.silentrave.ng` at all — there is no `/signup` route on either subdomain.
- The `OWNER` account is provisioned once, directly (seed script / manual DB insert / one-time setup flow), not through a public form.
- `STAFF` accounts are created **by an existing `OWNER`** from within the admin dashboard (`staff_users.invited_by` records who created the account). Expected volume: 3–4 staff accounts total, so this can be a simple "create account, set temporary password, staff resets on first login" flow rather than anything more elaborate (email-based invite links are a nice-to-have, not required for this small a number of accounts).

## Audit logging

Every action that touches money, pricing, or admission control writes a row to `audit_log_entries` (`02-database-schema.md`). At minimum:

| Action | Logged when |
|---|---|
| `ORDER_APPROVED` / `ORDER_REJECTED` / `ORDER_REVIVED` | Payment review decisions (with actor and note/reason) |
| `ORDER_REFUNDED` | Manual refund (and `restock` choice) |
| `ORDER_ISSUED_CASH` / `ORDER_ISSUED_COMP` | Admin-issued tickets |
| `BANK_ACCOUNT_CHANGED` | Any create/edit/activate of a payment account, with before/after |
| `PROOF_DUPLICATE_REFERENCE_ATTEMPT` | A submission collided with an existing transfer reference (system event, `actor_id` null) |
| `TICKET_RESENT` | Admin resend of tickets |
| `EVENT_CREATED` / `EVENT_UPDATED` / `EVENT_CANCELLED` / `EVENT_DATE_CONFIRMED` | Event mutations |
| `TIER_PRICE_CHANGED` / `TIER_CAPACITY_CHANGED` | Tier edits |
| `STAFF_ACCOUNT_CREATED` / `STAFF_ACCOUNT_DEACTIVATED` | Staff management |

Scan events (valid, duplicate, invalid, wrong-event, void, conflict) are recorded in the append-only `check_in_scans` ledger (`02`), and the admin audit view shows both together. System events with no human actor write `actor_id = NULL`.

This log is append-only — no API route exists to edit or delete audit log entries, including for `OWNER` accounts. If an entry is wrong, a correcting entry is added, the original is never removed.

## Password / session hygiene (baseline expectations)

- Passwords hashed with bcrypt or argon2 — never stored plaintext, never logged.
- Session tokens are short-lived and refreshed, not indefinite — reasonable default is a session lifetime in the hours-to-a-day range for admin/staff, not weeks, given the sensitivity of both financial data (admin) and door-access control (staff).
- `is_active = false` (soft-deactivation) is how a departing staff member or compromised account is disabled, preserving their historical `checked_in_by` and audit log attribution rather than orphaning those records.
