# Shared controls and release preparation

Batch B combines 5C.4, 5C.5 and 5C.6 on `feat/step5c-shared-controls-release`.
It follows PR #9's authorized merge `b3e511525290c7b754ed995c77344954d1fd02c6`.
Code and verification are in progress; [the batch report](BATCH_B_REPORT.md)
records completed, failed and pending evidence. Launch remains blocked.

The original poster, mint/purple identity, desktop links, mobile hamburger and
remembered light/dark choice are preserved. Previous preview packages remain
available; Batch B does not upload or deploy a preview.

Rate limits use `RATE_LIMIT_DRIVER=postgres` and a canonical base64url 32-byte
`RATE_LIMIT_SECRET`. A versioned HMAC hides normalized email/IP/code/user keys.
All eight callers await their counters; bucket thresholds and first-request
windows remain unchanged. One atomic database-clock upsert saturates bigint
counts safely. Failure returns a fixed private 503 before the protected work;
exhaustion returns 429 with Retry-After. Memory requires explicit local,
nonproduction configuration. It never substitutes for a failed shared backend.
IP comes from verified ingress and is normalized centrally, including mapped
IPv6. Campus NAT does not change the two unresolved orders per email/phone rule.
Expiry deletes at most 1,000 expired limiter rows with indexed SKIP LOCKED.

Mail reserves one recipient message in both database UTC day and month windows.
Defaults are `EMAIL_DAILY_BUDGET=90` and `EMAIL_MONTHLY_BUDGET=2700`; lower positive
budgets are allowed. These limits leave a margin, not a guarantee about provider
account usage. Reservation rows store only opaque IDs, window identity, amount,
state and timestamps. Retry keys reuse reservations. Quota denial precedes job
claim/attempt increments and defers QUEUED jobs to UTC reset plus 60 seconds.
The owner sees fixed QUOTA_DAY/QUOTA_MONTH reasons in existing email-job views.
Monthly exhaustion can defer never-sent jobs into the next month.

Definitive provider quota rejection pauses the shared gate until the matching
reset or a later Retry-After. Only a conclusively rejected first send can undo
its fresh firstSendAt marker and reservation under its claim fence. Earlier
uncertainty keeps the original 23-hour guard and identical encrypted payload.
Unknown/network outcomes retain conservative counts. Contacts take the same
gate/budget, use the published organizer recipient, and store no message body
or recipient in reservations. Busy/paused contacts receive private 503 with a
bounded Retry-After; the existing form retains input. No fifth order-mail kind.
Only quota metadata older than 40 days is cleaned up, at most 1,000 windows per
expiry invocation; business/storage/audit rows and queued mail are preserved.

The worker retains a 45-second run budget, batch cap 20, provider deadline 15
seconds, five-minute job lease, 60-second fenced gate and 600ms spacing. Aggregate
base64 attachments are bounded to 40 MiB and ten actual PDFs, one buyer recipient.
No provider/PDF/storage I/O holds a business or quota transaction.
Initial Netlify configuration uses `EMAIL_KICK_ENABLED=0`.

`scheduler/worker.ts` has no HTTP handler or caller-selected targets. One-minute
Cloudflare Cron source makes exactly two fixed HTTPS POSTs to silentrave.space,
expiry and email jobs, each authenticated with the server-only CRON_SECRET.
Calls omit credentials, reject redirects, disable caching and time out at 70
seconds; responses are discarded and errors contain fixed codes. Both targets
are attempted independently. Source/configuration is not a deployed scheduler.
Enablement, secret transfer and staleness monitoring belong to Batch C.

Three new chronological migrations create private limiter/mail metadata and
consolidate protection for all 21 application tables plus migration history.
Historical migration bytes remain unchanged. `sr_runtime` is a NOLOGIN group,
without elevated privileges, role inheritance, schema ownership or DDL rights.
A later operator creates a dedicated LOGIN member; its runtime credential must
be distinct from the named migration-owner credential.
Public/provider roles must never inherit that group; membership and unexpected
runtime DDL/ownership rights are explicit migration blockers.
All business tables use RLS with policies only for that group and precise
operation grants. Audit, scan
and order-line ledgers allow SELECT/INSERT; no business deletion was introduced.
The sync sequence/function are explicitly granted, schema-qualified and invoker
security. Runtime cannot read migration history. PUBLIC and provider API roles
receive no table/sequence/routine privileges or policies. Unknown tables, views,
sequences, routines, policies, column grants, owners or grants block migration
for operator reconciliation. Extension-owned objects and provider platform
schemas are outside this change. Default changes apply to the executing named
migration owner in public; do not run with an unreviewed ownership inventory.
Disable the unused Supabase Data API during separately approved hosted setup.

Buyer APPROVED polls every 60 seconds; active states retain eight seconds,
including EXPIRED because late proofs can change it. Refund/void revalidation,
visibility pause, error backoff, abort/generation fencing and manual refresh
remain. Owner organizer/venue/event auxiliary polls run only where used; global
notification status remains available. Disabled polls make no request.

Run `test:step5b-controls` for guarded isolated control tests and `test:step5b`
for the complete app regression with restricted runtime HTTP connections.
Fixture mutation/seeding and inspection use an operator connection, never a
hosted connection. Windows heavy checks run sequentially. Required release-code
checks also include lint, app/tooling types, readiness/policy, forward migration
preflights, offline Netlify build/generated Edge and Node ZIP acceptance, and
owned browser checks. `readiness` exits 1 with readyForLaunch=false by design.
Local API-role SQL denial does not prove hosted REST/GraphQL denial.

The representative fixture reports actual database size and ten-ticket payload
size/preparation time in `reports/step5b-*-measurements.json`. The local target is
database size below 300 MiB and preparation below 30 seconds, leaving 15 seconds
for the bounded provider call. It does not prove hosted performance or retained
database/storage growth. Before rollout, measure pg_database_size and table/index
sizes, encrypted/base64 mail payloads, all retained events and object bytes.
Review rate/mail cleanup backlog and real quota dashboards without printing PII.

The credit model is `15*productionDeploys + 2*webRequests/10000 + 20*deliveredGB
+ 10*sum(memoryGB*seconds)/3600`. Include broker calls, assets, API/SSR traffic,
polling, cron, scanner sync, retries, bots and all account previews. Example only:
two production deploys, 300k requests, 2 GB delivered and 8 GB-hours compute
total 210 credits, below the 225-credit planning target. Verify actual dashboards
and revise the operating plan before launch. Do not assume local test timing or
CDN hits establish billed usage. No automatic plan upgrade or paid overage.

Before any hosted migration, record exact approved head/build and eight migration
fingerprints; read-only inventory must confirm project identity, ownership,
history/checksums, roles, policies, grants, views, routines, sequences and existing
owner/session state. Reconcile unknown history separately; never reset/replay it.
Back up the DB and object bytes separately, encrypted off-site with owner-held
keys. Restore into an isolated target; verify owner hash/state, order/tier counters,
proof/PDF/banner linkage, signing/status keys, encrypted queued payload recovery,
worker gate, permissions and scan/audit records. Record retention and recovery
time. A DB export alone does not restore Storage objects.

Apply only the reviewed additive migration set through the matching direct/session
operator connection after approval. Builds generate Prisma but never migrate/seed.
Runtime uses a restricted TLS pooler connection with initial connection_limit=1
and pgbouncer=true when using transaction pooling. Verify transaction locks and
shared counters on the real pooler; local embedded PostgreSQL does not prove it.
Separately approve configuration, DNS, a frozen deployment, scheduler enablement
and non-delivery smoke tests. Review queued mail age/usage before any delivery.
Rollback preserves additive schema, queues/evidence and object bytes; rehearse a
compatible frozen app artifact with the restricted role in the isolated target.
Never assume a pre-privacy runtime artifact is a safe rollback.

Batch C covers hosted preparation/rollout; Batch D covers specifically approved
recipient delivery, webhooks, push, physical camera/iOS/PWA/offline/gate rehearsal
and launch decision. These remain unverified. Do not merge Batch B automatically.

Primary operational references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[Data API protection](https://supabase.com/docs/guides/api/securing-your-api),
[Prisma connections](https://supabase.com/docs/guides/database/prisma),
[separate object backups](https://supabase.com/docs/guides/platform/backups),
[Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits),
[Cloudflare Cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Netlify credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).
