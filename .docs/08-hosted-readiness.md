# Step 5 hosted readiness and launch plan

Current status (2026-10-06): PR #5 is merged and Netlify is selected for local
preparation; the user says the domain is ready. Hosted runtime/DNS are unverified.
The historical Step 5 plan below is preserved. The Step 5B Desktop plan governs
the local milestone sequence; [Step 5C.1 report](./09-netlify-runtime-auth.md)
records the approved build-plugin revision, implementation and current acceptance.

Prepared 2026-10-03, Africa/Lagos. This milestone prepares local tools and a
reviewable plan. It does not authorize hosted changes, mail/push, migrations,
account provisioning, purchases, deployment or PR merge. Next.js fullstack,
Supabase, Resend, guest checkout, manual approval and silentrave.space remain the
product direction. The historical OPEN stack/domain entries in 01 are superseded.

The user will create launch resources when requested after preparation. Domain
ownership, provider projects, regions, database contents and sender verification
are not established. The user chose **plan a free external scheduler** and asked
whether Netlify Free would fit better. Netlify is now an evaluated candidate;
the hosting choice has not been changed or provisioned.

## Local preflight

```powershell
bun --no-env-file run test:readiness
bun --no-env-file run readiness
bun --no-env-file run db:preflight
```

`readiness` reads only inherited environment variables and tracked migration
files. It makes no network request, reads no .env file, and emits fixed diagnostic
messages and migration fingerprints. Exit 1 means launch remains blocked
(expected today); exit 2 means inspection failed. `configurationValid` is syntax
only. `readyForLaunch` is deliberately false even with a syntactically complete
candidate. This command cannot verify resource ownership, DNS, credentials,
pooler project identity, privacy or provider availability.

`db:preflight` rejects hosted database URLs before starting the existing guarded
fixture. It replays the existing migration chain into owned disposable loopback
PostgreSQL, compares exact checksums/history, repeats deploy without reseeding,
and checks two independent interactive transactions, advisory locks, row locks,
SKIP LOCKED, rollback and release. Fixture seeding affects only that disposable
database. Output: `reports/step5-<platform>-db-preflight.txt`. It does not establish
Supavisor behavior or emulate Supabase grants/RLS. Existing 10s transaction/5s
connection-wait limits remain. Never target this script at a hosted database.

## Current adapters and required changes

| Area | Actual implementation | Proposed local work before launch |
|---|---|---|
| Storage | `src/lib/storage/supabase.ts` throws. Local disk holds proof/PDF/banner bytes. Banner API exposes only keys referenced by events. | Implement namespaced durable adapter and retain application proof authorization; integration tests with mocked storage HTTP, then separately approved hosted privacy checks. |
| Public/auth limits | `src/lib/rate-limit.ts` uses a process Map; all callers are synchronous. | Add a shared PostgreSQL fixed-window counter, HMAC-hashed keys, atomic increment/expiry and bounded cleanup; update every caller to await it. Fail closed on backend failure. |
| Realtime | `src/lib/events/emitter.ts` is process-local with no hosted publisher/subscriber. | Retain mandatory polling as the launch correctness path. Private authorized ID-only broadcast may follow; no public buyer/order channels. |
| Sessions/origins | Configured root/admin/staff hosts, parent-domain Secure/HttpOnly/Lax cookie, per-request DB/role checks and strict mutation Origins. | Test exact deployed host rewrites, cookies, staff password gate, wrong-surface denials and private headers. Never enable dev relaxation on previews/production. |
| Email | Resend HTTP transport, encrypted immutable retry bodies, global DB gate, fenced leases, 45s run budget, POST cron route with maxDuration=60 and x-cron-secret. | Keep queue semantics; host runtime and attachment sizing need validation. Real recipient sends remain approval-gated. |
| Push/Places | Web-push dispatch and Google Places New proxy exist; fixtures capture/blank credentials. | VAPID/device acceptance; Places attribution/content retention/key restriction review before enabling suggestions. Manual address/directions and polling remain available. |
| Supabase database API | Business tables are in public; migration SQL includes no RLS/revokes. | Prevent Data API bypass of app auth. Disable unused Data API exposure, or review additive RLS/revokes for all business/private infrastructure tables with anon/authenticated denial tests. |

Shared limiting must preserve independent email/phone unresolved-order caps and
campus NAT behavior. Preserve bucket thresholds and lookup's uniform response;
derive IP from the verified host's trusted header, rather than arbitrary
client-supplied forwarding headers. New counter migration must be additive;
transaction expiry uses database time. Retention/cleanup must not erase active
windows. The checker does not pretend a new env switch implements this backend.

### Durable storage design

Proposed buckets: `sr-banners` for public approved artwork and `sr-private` for
`proofs/` and `tickets/`. These names are proposals, not current configuration.
Only server credentials can write; no anon/authenticated insert/update/list
policy. The private bucket has no public access. Service credentials bypass RLS
and must remain server-only. [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)

Dispatch server-generated keys by allowlisted prefix; reject traversal and mixed
namespaces. Preserve re-encoding/MIME limits and PDF input-hash cache keys.
Immutable proof/banner uploads must not overwrite evidence on collision; PDF
retries handle identical existing content. A missing PDF is regenerated; provider
failure must not be mistaken for a cache miss. Use bounded HTTP timeouts.

**Preserve the existing stronger proof-read contract:** OWNER session plus
application HMAC signature plus 90s expiry, rechecked by the serving route.
Remote Supabase signed URLs are bearer credentials and do not recheck our OWNER
session. Do not hand them to the browser or redirect the proof route to them.
The adapter should return the existing signed application URL and the authorized
route should fetch the private bytes server-side. Buyer PDFs continue through
the status-token route with approval/void/refund checks. Public banners are the
sole deliberate exception. Keep Referrer-Policy/no-store/private headers.

Add post-commit orphan accounting and a dry-run lifecycle report before deleting
anything. Do not delete proofs because an upload/transaction failed until their
references are checked. Owner must approve retention duration and backups.
Supabase DB backups omit stored object bytes, and Free needs off-site exports.
[Backup limitations](https://supabase.com/docs/guides/platform/backups)

## Host comparison (provider docs checked 2026-10-03)

| Requirement | Vercel Hobby | Netlify Free candidate |
|---|---|---|
| Paid-event commercial use | Hobby restricted to non-commercial personal use. Launch blocker; no upgrade authorized. | Provider explicitly permits commercial projects on Free. |
| Minute scheduler | Built-in cron limited to daily execution. External scheduler required. | Standard cron expressions supported on all accounts. Scheduled execution capped at 30s. |
| Email worker | Node route maxDuration=60; verify actual configuration/bundle and next/after lifetime. | Current 45s worker exceeds scheduled cap. External caller to synchronous Node route or background wrapper is required. |
| Native modules/proxy | Local Next 16 build passes; hosted proof pending. | Docs list C++ addon/filesystem limitations for Node middleware. Our proxy imports native-engine Prisma/session validation: verify pinned Next 16.1.3 adapter behavior before committing to host. |
| Upload ceiling | Function request/response ceiling 4.5 MB. | Buffered 6 MB; binary base64 overhead reduces effective upload ceiling to about 4.5 MB. |
| Free traffic allowance | Separate product quotas; verify project dashboard. | 300 monthly credits shared by deploys/compute/traffic; site pauses at exhaustion. |

Sources: [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel cron](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Vercel function limits](https://vercel.com/docs/functions/limitations),
[Netlify commercial projects](https://www.netlify.com/blog/introducing-netlify-free-plan/),
[Netlify current credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/),
[Netlify scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/),
[Netlify function configuration](https://docs.netlify.com/build/functions/configuration/),
[Netlify Next.js support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).
Use current credit docs rather than the older commercial-use blog's legacy quotas.

Netlify is a plausible small-launch choice, pending adapter/security acceptance
and expected traffic. Do not remove server role checks to make its proxy build.
If proxy native loading fails, separately scope a routing-only proxy with
equivalent page/route guards, and test every denial/redirect before deployment.
No Netlify config or adapter install is introduced in this readiness PR.

For budgeting, current Netlify rates are 15 credits/production deploy,
10/GB-hour compute, 2/10,000 web requests, 20/GB delivery. Example only:
two external cron POSTs/minute over 30 days yield 86,400 requests (17.28 credits)
before compute; if each averages 0.1s at 1GB, compute adds 24 credits. This is
an assumption, not measured production behavior. Add buyer/owner polling,
scanner sync, public artwork traffic, bots and deploys. Four production deploys
use 60 credits; the theoretical 20 deploys consuming all 300 leaves no traffic
budget. Use preview builds during development, usage alerts and pre-event budget
review; no silent paid recharge. Quota pause on event night is an operational risk.

### Proposed free external scheduler

Cloudflare Workers Free Cron Trigger (`* * * * *`) is the proposed scheduler,
subject to account creation and separate deployment approval. One tiny scheduled
handler calls the two HTTPS root-host internal POST routes in parallel, with
the server-only `x-cron-secret`, no cookies, no secret URL query, redirects
rejected, and an approximately 70s outbound deadline. Store credentials as
Worker secrets. No public HTTP trigger is needed. Do not process PDFs/mail in
the Worker or log responses/environment. Log fixed endpoint labels/statuses,
count failures and alert on stale processing. Queue fencing/idempotent expiry
handle overlapping calls; leave retry state in the DB.

Free currently allows five cron triggers/account and 10ms CPU per cron; network
wait does not consume CPU and scheduled wall time is up to 15 minutes. Two
outbound calls fit the documented subrequest limits. Verify actual scheduled
CPU/error metrics before launch; this is a plan, not an availability guarantee.
[Cloudflare cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
This preserves the user-approved external-scheduler direction for either host.
Do not add unauthenticated GET wrappers to accommodate native cron defaults.

## Configuration contract

Set these only in provider secret/settings stores after the corresponding
approved setup. Never paste them into PRs/reports or pass passwords as CLI args.
The existing .env.example is for local development and now uses silentrave.space
as the settled domain example. The offline checker accepts inherited candidates.

| Variables | Production requirement |
|---|---|
| ROOT_DOMAIN / PUBLIC_BASE_URL | `silentrave.space` / `https://silentrave.space`; admin/staff are exact subdomains. Preview must use an isolated root plus both subdomains and independent secrets/data, or stay local-only. |
| DATABASE_URL | Provider Connect dialog's runtime transaction pooler, TLS (`sslmode=require` or verify-full), `pgbouncer=true`, initial connection_limit=1. Project identity verified manually. |
| DIRECT_URL | Matching direct or session pooler, TLS, no transaction pooling. Migrator credentials only in an approved operator environment. Build generation needs a syntactically valid placeholder; migration is separate from build. |
| STATUS_TOKEN_SECRET / TICKET_SIGNING_PRIVATE_KEY / TICKET_SIGNING_KID / optional old public keys | Preserve any existing production identity; for new isolated setup generate random secret and Ed25519 seed/key ID. Retain historic public keys for existing tickets. |
| STORAGE_DRIVER / STORAGE_SIGNING_SECRET | Batch A implements bounded Supabase HTTP and application-signed private reads. Server-only SUPABASE_URL / SUPABASE_STORAGE_SERVER_KEY and SR_PRIVATE_BUCKET / SR_BANNER_BUCKET are specified in [doc 10](10-uploads-durable-storage.md). Provisioning, legacy reconciliation and hosted acceptance remain separate. |
| EMAIL_TRANSPORT / RESEND_API_KEY / EMAIL_FROM / EMAIL_REPLY_TO / PUBLIC_BASE_URL / EMAIL_PAYLOAD_SECRET | Resend, verified fixed sender, valid reply-to and base64url 32-byte encryption key. Never rotate payload key while jobs depend on it. Capture is fixture-only. |
| CRON_SECRET / RESEND_WEBHOOK_SECRET | Random scheduler secret and provider Svix secret, server-only. Configure webhook endpoint/raw-body replay verification separately. |
| EMAIL_SEND_INTERVAL_MS / EMAIL_KICK_ENABLED | Current 600ms default and best-effort after() kicks; scheduler remains mandatory even when kicks work. No quota-delay/lease weakening. |
| VAPID trio / Google keys | Optional pending physical-device/restrictions/attribution approval. Never expose private VAPID or Places server key. Embed key is browser-visible and must have API/referrer restrictions. |

No OWNER_PASSWORD/OWNER_EMAIL, capture flags, fixture flags or ALLOW_DEV_ORIGIN=1
in a deployment. Build and runtime environments must be independently reviewed.
Avoid build-time hosted DB connections, and keep production keys out of previews.

## Forward migration and database protection plan

1. Record exact approved Git head and offline migration fingerprints. Read hosted
   engine version, project identity, business table inventory and
   `_prisma_migrations` history/checksums with a read-only operator connection.
   If history is absent, different or unfinished, stop for a separately reviewed
   reconciliation. Never use reset, db push, migrate dev, ad-hoc initial SQL or
   blind migration repair. A genuinely new empty project requires a separately
   reviewed initial provisioning plan; do not infer it from the local replay.
2. Take an encrypted DB export and separate object backup with recorded restore
   procedure. Restore into an isolated target and verify owners, orders, capacity
   counters, QR keys, worker gate and object linkage. Keep current owner hash,
   signing/status keys and prior migrations untouched; do not run owner/dev seeds.
3. Freeze forward SQL including the future shared-counter/security changes;
   inspect compatibility with current migrations, runtime role and schema. Replay
   on disposable PostgreSQL and a separately approved isolated Supabase project.
4. For hosted DB API protection, enumerate all public business tables/sequences/
   routines and infrastructure tables. Disable unused Data API exposure, or apply
   reviewed deny-by-default RLS/revokes and restricted runtime-role grants. Prove
   anon/authenticated REST cannot read private data or mutate admission/inventory.
   Direct Prisma roles need only required server privileges; avoid copying broad
   quickstart grants unreviewed. [Securing Supabase API](https://supabase.com/docs/guides/api/securing-your-api)
5. After explicit approval for the named target and pending forward set, run
   pinned `prisma migrate deploy` using DIRECT_URL in an operator environment,
   then read history/constraints/triggers/indexes and compare approved checksums.
   Do not run migrations from deployment builds. A failed migration needs a
   specific reviewed repair plan; never reset hosted data.
6. Exercise interactive callbacks, transaction-scoped advisory lock exclusion,
   row/SKIP LOCKED, rollback and actual checkout/approval/expiry/refund concurrency
   on an isolated target through DATABASE_URL. Run genuine parallel connections,
   not just one connection_limit=1 pool. If transaction pooling fails, review a
   session/direct runtime alternative and connection budget before changing it.
   [Supabase Prisma connection modes](https://supabase.com/docs/guides/database/prisma)

## Deployment and verification sequence (future approval only)

First resolve the host candidate and complete local storage/shared-limit/API
protection work on reviewed branches. Run full 176-case regression plus new
adapter/limiter tests after substantive application changes. Continue preserving
checkout lock order email namespace 1, phone 2, then sorted tiers; order-to-ticket
locks, immutable audit/scan ledger, QR matching and five-minute webhook verifier.

When the local code is ready, provide the user a concrete setup checklist:
domain ownership/access (no purchase authorized), selected host Free account,
Supabase project/region and existing-data status, Resend sender/subdomain,
Cloudflare scheduler account, and optional push/Maps needs. Resource creation,
provider secret entry and owner provisioning remain separately bounded actions.

Configure root/admin/staff DNS and HTTPS only after approval; verify cookie
scope and all hostname rewrites. Vercel's native Node path or Netlify's OpenNext
adapter must bundle Prisma/sharp/font files/scanner assets and keep private keys
out of client artifacts. Preserve assets/fonts/NotoSans-Regular.ttf tracing.
The current upload envelope can reach 5 MiB; provider ceilings apply before
handler validation. Verify multipart overhead near the 4 MiB file cap and reduce
the client/server envelope together if needed. Do not assume host ignores it.

Resend needs sender SPF/DKIM verification; review DMARC without overwriting
existing mail DNS. Register the signed webhook. Locally verify raw-body signatures,
duplicate/out-of-order handling, attachments and ten-ticket payload size before
requesting permission for a named test recipient. Provider attachment ceiling is
40MB after base64 encoding; production quota and sender validity remain unverified.
[Sender domains](https://resend.com/docs/dashboard/domains/introduction),
[Email attachment contract](https://resend.com/docs/api-reference/emails/send-email).

Before enabling Google keys, add required visible Google Maps attribution and
published privacy/terms; review persisted Places-derived venue data against
provider retention rules (place IDs are exempt). Server-side Places credentials
cannot rely on browser referrer restrictions; use API restrictions and a verified
server restriction strategy. Keep manual verified venue/directions working.
[Google Places policies](https://developers.google.com/maps/documentation/places/web-service/policies)

Deployed non-delivery smoke: public event/pages, sales-closed and empty states,
API auth/origin denial, signed-proof/session expiry, privacy/no-referrer, DB lock
contract, cron unauthenticated denial, fail-closed worker, backup restore evidence.
Then explicitly approved fixture event/recipient delivery and push tests, with
no changes to the permanent owner or real inventory. Finally physical Android
camera and Safari/iOS installed PWA/offline reload/durable sync/permissions.
Use one offline scanner for the entire event during outages; rehearse gates and
conflict recovery. Headless Chrome/CI do not prove physical-device behavior.

Roll back app deployment to an approved compatible artifact if needed; retain
additive DB migrations. Pause scheduler safely for provider issues while keeping
jobs queued, never clearing jobs to manufacture success. Restore only into a
separate recovery target unless a concrete production recovery is approved.

## Stop boundary

This PR completes readiness/preflight and local preparation only. Review and
merge approval are separate. Next suggested local milestone: durable storage,
shared limits and Supabase API protection implementation, with host compatibility
assessment scoped to the user's chosen candidate. No hosted command in this plan
has been executed. Launch remains blocked until code, configuration, recovery,
provider and physical-device acceptance are verified with their approvals.
