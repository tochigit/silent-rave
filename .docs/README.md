# Silent Rave — Technical Specification

Rebuild of an existing WordPress-based nightlife/events ticketing site (reference: nitroexperience.ng) as a modern Next.js + Postgres application, integrated with Paystack for Nigerian payments.

**Core principle:** behavioral parity with the reference site, not implementation parity. We are not cloning WordPress plugins — we are reproducing the customer-facing behavior on our own stack.

This is a living specification intended to be handed to an implementation model (or a human dev team) as an unambiguous build reference. Where a decision is still open, it is marked **OPEN** rather than guessed at.

## Documents in this spec

| Doc | Contents |
|---|---|
| [`01-context.md`](./01-context.md) | Project background, stack, module tree, product decisions — the "why" |
| [`02-database-schema.md`](./02-database-schema.md) | Full Postgres schema: tables, columns, constraints, indexes, state machines |
| [`03-api-routes.md`](./03-api-routes.md) | Every API endpoint: public, checkout, admin, staff — request/response contracts |
| [`04-paystack-integration.md`](./04-paystack-integration.md) | Payment flow, webhook contract, verification logic, idempotency, security |
| [`05-ticketing-and-qr.md`](./05-ticketing-and-qr.md) | Ticket-unit model, PDF generation, QR signing, scanner flow, check-in abuse mitigation |
| [`06-auth-and-roles.md`](./06-auth-and-roles.md) | Admin vs. staff roles, subdomain routing, session scope, audit logging |

## Reading order

If implementing top-to-bottom: **01 → 02 → 06 → 04 → 05 → 03**. The API routes doc (03) references entities and flows defined in all the others, so read it last, or use it as the checklist once the rest is understood.

## Non-goals for v1

- No refund automation (manual admin action only; Paystack refund API is a documented future step, not built now)
- No offline-mode for the scanner (documented as a stretch goal in `05`, not required)
- No multi-currency support (NGN only, Paystack only)
- No native mobile app — staff scanner and customer site are both mobile-web

## Status

Draft v1 — architecture and contracts locked for the decisions marked as such in each doc. Items marked **OPEN** need a decision before or during implementation of that section.
