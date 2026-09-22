# 06. Auth, Roles, and Subdomain Separation

## Roles

Two roles, one `staff_users` table (see `02-database-schema.md`):

| Role | Access |
|---|---|
| `OWNER` | Full CRUD: events, venues, organizers, ticket tiers, pricing, orders, refunds, staff account management, audit log — everything |
| `STAFF` | QR scanner / check-in endpoints only, plus optionally a read-only "tonight's attendee list." No pricing, no orders, no financial data, no event/venue/organizer editing |

There is no public/customer authentication in v1 — customers check out as guests (name + email at checkout, no account creation). This matches the reference site's behavior and keeps checkout friction low, which matters for a mobile-first, impulse-purchase-driven ticketing flow.

## Subdomain architecture

- `silentrave.ng` (or the final domain) — public customer-facing site
- `admin.silentrave.ng` — owner dashboard
- `staff.silentrave.ng` — scanner / check-in interface

**One codebase, one database, shared backend.** The subdomains are different Next.js route groups (or separate frontend entry points, depending on final routing decision) hitting the same API. This is not three separate applications — it's one application with three audiences.

**Routing:** Next.js middleware inspects the `host` header on each request and rewrites to the appropriate route group (`/admin/*`, `/staff/*`, or the public site) before it reaches the page/API handler.

**Session cookie scope:** the session cookie must be set with `Domain=.silentrave.ng` (leading dot, root-domain scope) so a session established on one subdomain is recognized appropriately across the others where relevant — though in practice, admin and staff sessions should remain **functionally separate**: logging into `admin.silentrave.ng` should not grant scanner access on `staff.silentrave.ng` without the account actually holding appropriate role, and vice versa. The shared cookie domain is a deployment/infra convenience, not a statement that the two panels trust each other's sessions blindly — every request is still role-checked server-side regardless of where the cookie came from.

## Server-side enforcement — the non-negotiable part

**Every API endpoint that touches admin or staff functionality checks the authenticated user's role on the server, on every request.** This is not optional and is not satisfied by hiding buttons in the UI.

```
Middleware / route handler pattern:

1. Extract session from cookie
2. No valid session → 401
3. Valid session, but role does not match what this endpoint requires → 403
4. Role matches → proceed
```

Concretely: if a `STAFF` role account somehow sends a request to `GET /api/admin/orders` (e.g. by guessing the URL, inspecting network traffic, or a compromised staff device), the server must return `403 Forbidden` — the fact that the staff subdomain's UI never shows a link to that endpoint is irrelevant to whether the endpoint itself is protected. Treat every admin-only and staff-only route as though a hostile actor already has the URL.

## Account creation — invite-only, no public signup

- No public registration path exists for `admin.silentrave.ng` or `staff.silentrave.ng` at all — there is no `/signup` route on either subdomain.
- The `OWNER` account is provisioned once, directly (seed script / manual DB insert / one-time setup flow), not through a public form.
- `STAFF` accounts are created **by an existing `OWNER`** from within the admin dashboard (`staff_users.invited_by` records who created the account). Expected volume: 3–4 staff accounts total, so this can be a simple "create account, set temporary password, staff resets on first login" flow rather than anything more elaborate (email-based invite links are a nice-to-have, not required for this small a number of accounts).

## Audit logging

Every action that touches money, pricing, or admission control writes a row to `audit_log_entries` (`02-database-schema.md`). At minimum:

| Action | Logged when |
|---|---|
| `EVENT_CREATED` / `EVENT_UPDATED` / `EVENT_CANCELLED` | Any admin event mutation |
| `TIER_PRICE_CHANGED` / `TIER_CAPACITY_CHANGED` | Any admin edit to a ticket tier's price or capacity |
| `ORDER_REFUNDED` | Manual refund action |
| `STAFF_ACCOUNT_CREATED` / `STAFF_ACCOUNT_DEACTIVATED` | Owner managing staff accounts |
| `TICKET_CHECKED_IN` | Every successful scan (see `05-ticketing-and-qr.md`) |
| `DUPLICATE_SCAN_ATTEMPT` | Every scan of an already-checked-in ticket (see `05-ticketing-and-qr.md`) |

This log is append-only — no API route exists to edit or delete audit log entries, including for `OWNER` accounts. If an entry is wrong, a correcting entry is added, the original is never removed.

## Password / session hygiene (baseline expectations)

- Passwords hashed with bcrypt or argon2 — never stored plaintext, never logged.
- Session tokens are short-lived and refreshed, not indefinite — reasonable default is a session lifetime in the hours-to-a-day range for admin/staff, not weeks, given the sensitivity of both financial data (admin) and door-access control (staff).
- `is_active = false` (soft-deactivation) is how a departing staff member or compromised account is disabled, preserving their historical `checked_in_by` and audit log attribution rather than orphaning those records.
