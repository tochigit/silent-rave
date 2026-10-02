# Phase 4 report (local verification complete; CI pending)

Step 2 on `feat/phase4-email-tickets-refunds`, based on merged baseline
`982eb9f`. No merge or later milestone authorized. Current spec: v2.1.2.

## Step 0

Fresh Step 0 regression: PASSED, 112 tests/eight files, runner exit 0 and cleanup
complete (`reports/phase3b-win32-test-output.txt`). First attempt failed at app readiness before
any tests executed; PostgreSQL shutdown checkpoint took 73 seconds, exceeding
the old 30-second cleanup timeout. It later shut down normally. Failure evidence
is `reports/phase4-step0-readiness-failure.txt`. Fixture-only readiness/shutdown
timeouts were increased to 300/120 seconds; business/test assertions unchanged.

Checkout locks normalized email (advisory namespace 1), phone (namespace 2),
then tier rows in ascending tier-id order, on every collision retry. Lazy expiry
is a separate transaction before checkout. Existing-order review/release paths
lock the order before sorted tiers and do not take checkout advisory locks;
expiry sorts tier aggregates globally across its locked order batch. No lock
fix needed. GOOGLE_MAPS_EMBED_API_KEY and iframe/referrer restriction comment
already present, so no rename or Maps code required.

## Conflicts and resolutions

- Brief's 109/7-file baseline is stale: current baseline is 112 in eight files,
  including baseline-regressions. All remain required.
- Doc 06 requires refund password re-entry; doc 03 omits password in its body.
  Retain password, verified against the caller's hash before the transaction.
- Doc 04 says tickets only queued by approval, then explicitly allows owner
  resends. Implement both specified paths; no other producer added.
- Doc 05 initially says dates are always confirmed, then defines unconfirmed
  date rendering. Its explicit "Date to be announced" behavior wins at render.
- Retry idempotency versus deriving links at each send: current Resend rejects
  changed payloads for reused keys. Prepare at first send, encrypt the complete
  immutable payload (including attachments) at rest, retry those exact bytes.
  Plaintext links/tokens never persist; admin DTO excludes payloads entirely.
  Token version/recipient changes must stop retries for owner review.
- Provider idempotency is finite (24h), so automatic ambiguous retries stop at
  23h from first provider attempt with DELIVERY_UNCERTAIN. Owner must reconcile
  with provider before intentionally creating a fresh resend. No indefinite
  exactly-once guarantee is claimed.
- Claiming twenty jobs up front risks lease expiry before late sends. Claim
  one just before processing, cap each invocation at twenty, and use ownership
  fencing plus a database-wide worker gate to serialize provider spacing.
  Hosted invocations require a configured runtime budget and minute scheduler.
- Old sandbox network claim is historical. Actual account/domain/send/webhook
  access remains unverified; tests use mocks, never real recipients.

## Current official references

- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend errors](https://resend.com/docs/api-reference/errors)
- [Resend raw-body/Svix verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Svix signature scheme](https://docs.svix.com/receiving/verifying-payloads/how-manual)
- [React Email rendering](https://react.email/docs/utilities/render)
- [pdf-lib custom fonts](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Supabase Cron](https://supabase.com/docs/guides/cron)


## Implementation

1. `src/lib/email/config.ts`: fail-closed transport/from/reply-to/public origin;
   server-only payload encryption key; 600ms default spacing, six attempts,
   1m/5m/30m/2h/6h +/-10% backoff, 5m claim, twenty-job cap, 15s timeout.
2. `transport.ts`: direct HTTPS via built-in fetch (no Resend SDK). Carries
   job id as Idempotency-Key and job_id tag; base64 attachments. Private capture
   files use exclusive creation and reject changed payloads for a reused key.
3. `worker.ts`/`payload.ts`: SKIP LOCKED JIT claims, short transactions, ownership
   tokens and final fenced lease renewal. All provider/render/storage I/O after
   commit. A shared singleton gate serializes spacing across instances and
   preserves quota/Retry-After pauses. Constant error allowlist avoids PII.
   First-send payload is AES-256-GCM encrypted with job-id AAD. It is immutable
   for retries; recipient/token-version changes fail closed. Sends stop when
   fewer than 15 seconds remain in the 45-second invocation budget; next cron
   handles remaining jobs. Hard route runtime is 60 seconds.
4. React Email renderer `@react-email/render` 2.1.0 with functional React JSX;
   no deprecated component package. Four fixed subjects; React HTML escaping
   and explicit plain-text markup/CRLF escaping. Reject decisions are captured
   in the enqueue transaction; legacy queued jobs fall back to the latest proof.
   One attachment per ordered ticket unit; no bank-account data queried.
5. `venues/directions.ts`: pure place-id/coordinates/HTTPS fallback helper.
   No Maps embed or public event endpoint added.
6. `tickets/pdf.ts`: pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1, qrcode 1.5.4;
   pure JS generation suitable for a small Node/serverless host, without a
   browser process. Licensed bundled Noto Sans font with subset embedding,
   Lagos date text, stored-token vector Q QR, 60mm box/4-module quiet zone and
   >=40mm active symbol, clickable directions. Cache hash covers rendered text,
   QR, directions, font bytes and layout version; missing/mismatched cache is
   regenerated privately. Revalidate inputs/order after I/O; cached reads do not
   unnecessarily update the unit/sync_seq. Uniform authz/status download errors.
7. Status response includes first-party authenticated PDF route links only;
   both status/PDF routes send private no-store and no-referrer.
8. Password-confirmed owner refund locks order then sorted ticket units; checked
   tickets require acknowledgement. Sorted tier aggregate restock is clamped
   at zero. Order transition, void trigger updates and audit are one transaction;
   repeated/concurrent calls never restock twice. No refund email or bank I/O.
9. Resend locks the order, counts the previous hour's TICKET_RESENT audit rows
   using DB time, queues fresh resend UUID and writes audit atomically. Limit
   five/order/hour is shared across instances; no editable recipient accepted.
10. Owner-only job list uses validated filters/pagination and an allowlisted
    DTO; same DTO in order detail. Payloads/claims/recipients/tokens excluded;
    last_error re-sanitized at response time for legacy rows.
11. Svix 2.6.1 verifies RAW body before JSON parsing; its standardwebhooks
    verifier uses a 300-second tolerance and constant-time signature comparison.
    Streaming 64KiB cap, message-id/tag matching, terminal status predicates;
    repeats do not change updated_at, BOUNCED wins, unknown types return 200.
12. Constant-time fail-closed x-cron-secret POST endpoint, Next after() best-effort
    kicks only after route/service commit, and dev-only capture loop. No HTTP
    or PDF work was added inside approve/reject/proof database transactions.

## Verification design and limitations

PostgreSQL, migrations, lock races, Next HTTP authorization, sharp, React Email,
PDF rendering/extraction and private local storage are real. Resend fetch is
mocked; capture never sends externally. Worker clocks/sleep/random are injected
and timestamps are backdated, with no test delay sleeps. Readiness probes and
the existing lookup response padding are runtime/fixture behavior. Webhook
signatures use a generated fixture secret and real Svix signing/verification.
Provider acceptance crashes are fault-injected; the fake provider deduplicates
effective sends by job id and exact body. Python QA pins PyMuPDF 1.28.2 and
ZXing 3.1.1; it renders the actual PDF and decodes its QR. OpenCV was replaced
after a decoder hang, and its failure evidence is retained.

Refund and PDF access checks cannot recall a provider request or download that
was already dispatched before the refund. Distributed process suspension
between a final fence and the HTTPS call cannot establish indefinite exactly-once
delivery; provider idempotency and the conservative retention cutoff are the
safety boundary. Job/gate timestamps require synchronized application clocks.

## Required live launch checks (all UNVERIFIED here)

- Create/connect Supabase; replay the forward migrations on a disposable hosted
  database; exercise real pooler interactive transactions, order/tier locks,
  SKIP LOCKED and migration DDL via the direct/session connection.
- Implement durable private storage (Supabase adapter remains an explicit stub)
  and verify proof/PDF read/write/cache behavior across invocations and hosts.
- Replace/document shared production Phase 3 public/auth limiters (currently
  in-memory). Phase 4 resend and worker pacing already use PostgreSQL state.
- Verify Vercel Node runtime, traced font, duration/payload/memory limits,
  eligibility and configured public/admin/staff origins. No paid upgrade or
  deployment was performed; user's selected free host remains unchanged.
- Configure Supabase Cron/pg_net or equivalent to POST the internal endpoint
  every minute with x-cron-secret, held in secret storage; monitor queue/FAILED
  jobs and verify recovery after a missed invocation. No scheduler installed.
- Configure Resend API/from/reply-to/webhook secrets and encryption key;
  verify domain DNS/DKIM/SPF, real PDF attachment send and real webhook signature/
  delivery/bounce. Confirm account rate/quota settings and alert on pauses.
- Reconcile DELIVERY_UNCERTAIN in provider logs before issuing a fresh resend.
- Purchase/configure the intended domain and DNS only when authorized; all app
  hostnames come from environment config. Build the customer status page in its
  later milestone; email links already target that specified future path.

No hosted DB, real recipient, live webhook, domain change or deployment was used
to obtain a pass. These checks remain deployment work, not Phase 4 completion.

## Files changed

```text
.docs/02-database-schema.md
.docs/PHASE4_REPORT.md
.env.example
.github/workflows/baseline.yml
CHECKPOINT.md
README.md
assets/fonts/NotoSans-Regular.ttf
assets/fonts/OFL.txt
assets/fonts/README.md
bun.lock
next.config.ts
package-lock.json
package.json
prisma/migrations/20261002000000_phase4_email_state/migration.sql
prisma/schema.prisma
reports/phase3b-win32-test-output.txt
reports/phase4-build-output.txt
reports/phase4-config-transport-win32-test-output.txt
reports/phase4-content-first-run-failure.txt
reports/phase4-focus-win32-test-output.txt
reports/phase4-full-first-run-failure.txt
reports/phase4-full-second-run-failure.txt
reports/phase4-lint-node-incomplete.txt
reports/phase4-lint-output.txt
reports/phase4-step0-readiness-failure.txt
reports/phase4-test-output.txt
reports/phase4-typecheck-output.txt
reports/phase4-win32-test-output.txt
scripts/email-dev-loop.ts
scripts/fixture.ts
scripts/requirements-pdf-test.txt
scripts/run-phase3b.ts
scripts/run-phase4.ts
scripts/verify-ticket-pdf.py
src/app/api/admin/email-jobs/route.ts
src/app/api/admin/orders/[id]/approve/route.ts
src/app/api/admin/orders/[id]/refund/route.ts
src/app/api/admin/orders/[id]/reject/route.ts
src/app/api/admin/orders/[id]/resend-tickets/route.ts
src/app/api/admin/orders/[id]/route.ts
src/app/api/internal/process-email-jobs/route.ts
src/app/api/orders/[code]/proof/route.ts
src/app/api/orders/[code]/status/route.ts
src/app/api/orders/[code]/tickets/[ticketId]/pdf/route.ts
src/app/api/orders/lookup/route.ts
src/app/api/webhooks/resend/route.ts
src/lib/email/config.ts
src/lib/email/dto.ts
src/lib/email/kick.ts
src/lib/email/payload.ts
src/lib/email/templates.tsx
src/lib/email/transport.ts
src/lib/email/worker.ts
src/lib/orders/errors.ts
src/lib/orders/refund.ts
src/lib/orders/resend.ts
src/lib/orders/review.ts
src/lib/storage/local.ts
src/lib/tickets/pdf.ts
src/lib/venues/directions.ts
tests/phase4-kick-failure.test.ts
tests/phase4/config.test.ts
tests/phase4/directions.test.ts
tests/phase4/fixtures.ts
tests/phase4/kick.test.ts
tests/phase4/pdf.test.ts
tests/phase4/routes.test.ts
tests/phase4/templates.test.ts
tests/phase4/transport.test.ts
tests/phase4/webhook.test.ts
tests/phase4/worker.test.ts
```

## Local verification

- Fresh Step 0: `bun --no-env-file run test:phase3b`, 112 pass / 0 fail,
  eight files, exit 0 and cleanup complete.
- Final full matrix: `bun --no-env-file run test:phase4`, 145 pass / 0 fail
  in 17 files plus two pass / zero fail in the separate failing-kick HTTP
  app. Total 147 (112 preserved baseline + 35 Phase 4), exit 0, cleanup complete.
- `bun --no-env-file node_modules/eslint/bin/eslint.js .`: PASS, no findings.
  Standard Node-based `bun run lint` was stopped after slow Windows module
  loading and is INCOMPLETE locally. `--bun run lint` still used the Windows
  Node command shim, so that attempt was also stopped. Direct Bun executed
  the same ESLint config/rules/files. Both CI platforms run the standard command.
- `bun --no-env-file run typecheck`: PASS, application and tooling TypeScript.
- `bun --no-env-file run build`: PASS, standalone production output. Build
  used syntactic loopback DATABASE_URL/DIRECT_URL, with no database connection.
- Actual rendered ticket PNG visually inspected: full diacritics, readable
  content, directions and QR. Automated exact QR decode and embedded font
  checks passed. Font asset present in standalone output.
- Root .env remains absent; no owned fixture/app/database processes remain.

Complete command/check output is retained in reports. The required combined
full output is also copied verbatim to `reports/phase4-test-output.txt`.
Full Step 0 and final combined outputs follow, without omissions.

Earlier failures are retained separately: readiness/shutdown timeout, Python
warning preceding JSON, a fake-time expectation, cold login compilation,
OpenCV decoder hang, overbroad storage-path assertion, and empty Python -c
output on Windows. Corrections changed fixture/verification handling and kept
all required assertions. Baseline test files remain unchanged.

## Complete Step 0 output

```text
Phase 3b: all test files; real HTTP, PostgreSQL, and sharp; no email provider.
Fixture: isolated loopback PostgreSQL; root .env is untouched.
waiting for server to start..... done
server started
Prisma schema loaded from prisma\schema.prisma

✔ Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 640ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate

Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "silentrave_test", schema "public" at "127.0.0.1:61102"

1 migration found in prisma/migrations

Applying migration `20260930000000_v2_1_baseline`

The following migration(s) have been applied:

migrations/
  └─ 20260930000000_v2_1_baseline/
    └─ migration.sql
      
All migrations have been successfully applied.
✔ OWNER account created: owner@silentrave.ng (Fixture Owner) — id 6c239a4a-1d5c-47fd-91c7-9358f78b1455
  Log in at /admin (or admin.localhost).
✔ dev fixture event created: dev-fixture-silent-rave (Early Bird ×30 @ ₦5,000, Regular ×50 @ ₦10,000 — confirmed date)
✔ dev fixture payment account created (active)
Fixture app ready; strict Origin checks; dedicated app port.
bun test v1.3.14 (0d9b296a)

tests\phase3b\authz.test.ts:
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/payments → 401 [84.11ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/payments → 403 [887.77ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/payments → 200 [3070.27ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/orders/__ID__ → 401 [147.53ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/orders/__ID__ → 403 [149.83ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/orders/__ID__ → 200 [3368.37ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/payment-accounts → 401 [136.09ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/payment-accounts → 403 [142.50ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/payment-accounts → 200 [2302.21ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous POST approve/reject → 401 (proxy gates before the route) [282.83ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF POST approve/reject/payment-accounts → 403 [454.91ms]
(pass) authorization — STAFF and anonymous vs every admin route > the order is untouched by every rejected admin call above [713.68ms]
(pass) payment-accounts — password re-entry + at-most-one-active + audit > create + activate requires the OWNER's password; wrong password → 403 [2363.61ms]
(pass) payment-accounts — password re-entry + at-most-one-active + audit > PATCH edits with password re-entry, audits before/after, keeps one active [4573.69ms]
(pass) status tokens on order routes > status route: missing/wrong token and unknown code all 404 uniformly [5064.08ms]
A3 timing (ms): unknown code=276.3, wrong token=233.8, missing token=207.0
(pass) status tokens on order routes > proof route: unknown code, wrong token and missing token return the IDENTICAL status code and body, in comparable time (A3) [934.12ms]
(pass) signed proof-image URLs (owner-only, expiring) > valid signed URL + OWNER session → 200 image; without session → 401; tampered sig → 403 [4192.94ms]
(pass) signed proof-image URLs (owner-only, expiring) > expired signed URL → 410 even with an OWNER session; non-proof namespace → 403 [343.95ms]
(pass) signed proof-image URLs (owner-only, expiring) > admin order detail mints short-lived signed URLs but never leaks the raw storage path [206.34ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST /api/auth/login with bad Origin → 403; missing Origin → 403 [445.36ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST approve with bad Origin → 403 and no state change [3702.02ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST reject with bad Origin → 403 [2844.11ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST payment-accounts with bad Origin → 403; PATCH with bad Origin → 403 [316.66ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST logout with bad Origin → 403 [1070.30ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > same-origin requests still work (regression): login + logout round-trip [1184.36ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > GET admin routes do NOT require Origin (06 scopes the check to state-changing methods) [161.12ms]
(pass) Origin-check STRICT DEFAULT (A2) — ALLOW_DEV_ORIGIN is unset on this server > flag UNSET → strict: the ROOT host's Origin is NOT accepted on the admin surface (was the old dev relaxation) [2804.11ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > ALLOW_DEV_ORIGIN=1 set while NODE_ENV=production → startup REFUSES [450.23ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > flag UNSET in production mode → the guard passes (strict, boots normally) [248.54ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > flag set in DEV mode → the guard passes (the opt-in is legal outside production) [126.78ms]
(pass) internal expire-holds guard > missing or wrong CRON secret → 401; correct secret → 200 [2531.78ms]
(pass) order status endpoint content rules (03) > no PII beyond buyer-entered data; ticket list only when APPROVED; late_proof_received flag [165.26ms]

tests\phase3b\baseline-regressions.test.ts:
(pass) Imported baseline regressions > MAX_QTY_PER_ORDER applies to the whole order across multiple lines [804.53ms]
(pass) Imported baseline regressions > revive respects another buyer's reservation and returns CAPACITY_GONE without side effects [2392.17ms]
(pass) Imported baseline regressions > a sweep locks tiers globally across orders, avoiding a cycle with a multi-tier writer [1633.42ms]

tests\phase3b\checkout.test.ts:
(pass) initialize — validation list (03) > happy path: 201, order code from the unambiguous alphabet, derived status token, server-side price [231.72ms]
(pass) initialize — validation list (03) > holder_names length mismatch → 400 [138.24ms]
(pass) initialize — validation list (03) > quantity over MAX_QTY_PER_ORDER (10) → 400 [170.22ms]
(pass) initialize — validation list (03) > tier belonging to a different event → 400 (VALIDATION) [446.98ms]
(pass) initialize — validation list (03) > DRAFT event → 409; unconfirmed date → 409 [467.92ms]
(pass) initialize — validation list (03) > sales window closed → 409 [278.34ms]
(pass) initialize — validation list (03) > no active payment account → 503 and nothing reserved [228.29ms]
(pass) initialize — atomic conditional reservation under concurrency > 8 parallel requests for the last 4 units: exactly 4 succeed, 4 get 409, CHECKs never violated [1894.70ms]
(pass) initialize — atomic conditional reservation under concurrency > single line exceeding availability → 409 with nothing partially reserved [175.81ms]
(pass) initialize — atomic conditional reservation under concurrency > multi-line order where ONE line fails → 409, the other line rolled back too [252.20ms]
(pass) initialize — abuse limits (04) > third unresolved order for the same EMAIL is refused (cap 2) [855.76ms]
(pass) initialize — abuse limits (04) > third unresolved order for the same PHONE is refused (cap 2), across different emails [701.18ms]
(pass) initialize — abuse limits (04) > resolved orders don't count toward the cap (an APPROVED order frees the email) [669.04ms]
(pass) initialize — abuse limits (04) > two different emails from the SAME IP are NOT blocked by any unresolved cap (IP is rate-only) [888.44ms]
(pass) initialize — abuse limits (04) > per-IP RATE limit triggers at its threshold (default 10/hour) [3565.46ms]

tests\phase3b\closeout.test.ts:
(pass) A1 — initialize rejects ended events (03 v2.1.1: ends_at > now()) > ENDED event (PUBLISHED, date-confirmed, open sales window) → 409, nothing reserved [402.51ms]
(pass) A1 — initialize rejects ended events (03 v2.1.1: ends_at > now()) > event IN PROGRESS (starts_at past, ends_at future) → still purchasable (201) [260.58ms]
(pass) A6 — same-email CONCURRENT checkout cannot exceed the 2-unresolved cap > 5 PARALLEL initialize (same email, different tiers): exactly 2 succeed, 3 get 429, caps never exceeded [919.00ms]
(pass) A4 — lookup rate limiting counts nonexistent codes; limited responses are identical > a NONEXISTENT code fills its own per-code bucket: 4th lookup of a fake code → 429 [2315.11ms]
(pass) A4 — lookup rate limiting counts nonexistent codes; limited responses are identical > after the threshold, an EXISTING code and a NONEXISTENT code get the IDENTICAL limited response [2654.66ms]
(pass) A5 — db:fixture refuses unsafe environments (guards run before ANY destructive step) > NODE_ENV=production → refuses (exit 1) before doing anything [200.07ms]
(pass) A5 — db:fixture refuses unsafe environments (guards run before ANY destructive step) > DATABASE_URL pointing at a non-embedded Postgres → refuses (exit 1) before doing anything [337.49ms]
(pass) B — proof vs sweep racing on a hold-boundary order (no orphan PENDING proofs) > lapsed hold, proof upload and sweep in parallel: EXPIRED + released exactly once + ONE late-flagged PENDING proof [2337.70ms]

tests\phase3b\lookup.test.ts:
(pass) lookup — uniform 202 responses, no order data > matching and non-matching code/email give byte-identical 202 bodies [1249.22ms]
(pass) lookup — uniform 202 responses, no order data > malformed body → same generic 202 (no validation oracle) [496.87ms]
(pass) lookup — uniform 202 responses, no order data > no order data in any response payload [1198.75ms]
(pass) lookup — STATUS_LINK jobs (match only, fresh keys, nothing sent) > job created ONLY on a match, with a fresh key each time [1132.42ms]
(pass) lookup — rate limits (per IP and per order code) > per-code limit triggers at its threshold (3/hour) [1104.56ms]
(pass) lookup — rate limits (per IP and per order code) > per-IP limit triggers at its threshold (10/hour) [3085.26ms]

tests\phase3b\proofs.test.ts:
(pass) proof — file validation (magic bytes, size, dimensions) > non-image file → 422 [599.25ms]
(pass) proof — file validation (magic bytes, size, dimensions) > disguised file (renamed .jpg but wrong magic bytes) → 422 [556.94ms]
(pass) proof — file validation (magic bytes, size, dimensions) > oversized (> 4 MB) valid JPEG → 422 [756.48ms]
(pass) proof — file validation (magic bytes, size, dimensions) > absurd pixel dimensions → 422 [499.75ms]
(pass) proof — file validation (magic bytes, size, dimensions) > PNG and WebP accepted; stored re-encoded JPEG strips EXIF [4678.52ms]
(pass) proof — transfer reference & duplicate handling > duplicate LIVE transfer_reference → 409 + system audit PROOF_DUPLICATE_REFERENCE_ATTEMPT, no row [3140.33ms]
(pass) proof — transfer reference & duplicate handling > duplicate image (same sha256, different order) → FLAGGED, not blocked [1367.87ms]
(pass) proof — transfer reference & duplicate handling > idempotent retry with the same client_submission_id creates no second attempt [801.20ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > no proof in 15 min → sweep sets EXPIRED + releases; second sweep is a no-op [1057.47ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > proof submitted → hold becomes first_proof_at + 48h and does NOT move on resubmission [3248.21ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > wrong/missing status token and unknown code on the proof route are INDISTINGUISHABLE (A3: uniform 404) [925.61ms]
(pass) proof — LATE proofs (04 'Late proofs') > within grace → recorded PENDING with flags.late, order STAYS EXPIRED, inventory untouched, in queue, revivable [2881.31ms]
(pass) proof — LATE proofs (04 'Late proofs') > outside grace (hold_expires_at + 24h) → 410 [576.66ms]
(pass) proof — LATE proofs (04 'Late proofs') > a SECOND late proof is rejected [1575.93ms]

tests\phase3b\review.test.ts:
(pass) approveOrder — concurrency and idempotency > double-click + two admins racing: ONE transition, sold incremented once, exactly N tickets, ONE TICKETS job [1859.98ms]
(pass) approveOrder — concurrency and idempotency > approve on a CANCELLED event → EVENT_CANCELLED, nothing changed [994.12ms]
(pass) approveOrder — concurrency and idempotency > approve requires confirmed_in_bank: true [1302.98ms]
(pass) approveOrder — concurrency and idempotency > approve vs reject racing on the same PROOF_SUBMITTED order: exactly ONE wins, the loser gets a clean INVALID_STATE, inventory consistent [1687.14ms]
(pass) approveOrder — concurrency and idempotency > approve vs sweep racing on an order at its hold cap: consistent final state, inventory never negative, no double release [1883.29ms]
(pass) full lifecycles > initialize → proof → approve: statuses, inventory, emails, audit [1480.17ms]
(pass) full lifecycles > initialize → proof → reject(resubmittable) → resubmit ×3 → fourth rejection exhausted → REJECTED, inventory released once [3992.93ms]
(pass) full lifecycles > OWNER closing a NEEDS_RESUBMIT order → REJECTED and inventory released once (fresh close-<n> email key) [1935.52ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > revive with capacity: EXPIRED + PENDING proof → APPROVED, re-reserves atomically [1551.81ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > revive WITHOUT capacity → CAPACITY_GONE rollback, then dismiss → REJECTED final, releases nothing [2550.94ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > an order that expired from NEEDS_RESUBMIT is NOT revivable (no PENDING proof) [1969.86ms]
(pass) sync_seq trigger (02 v2.1) > changes on INSERT (mint) and UPDATE (check-in, void); monotonic per statement [1772.09ms]
SAMPLE CLOSE AUDIT ROW:
{
  "id": "d3f6d4c8-8fca-458b-94ad-bdc7b5767a74",
  "actor_id": "6c239a4a-1d5c-47fd-91c7-9358f78b1455",
  "action": "ORDER_REJECTED",
  "entity_type": "order",
  "entity_id": "60156b93-8515-4f8f-bea3-598e00fb1ee7",
  "metadata": {
    "to": "REJECTED",
    "from": "NEEDS_RESUBMIT",
    "after": {
      "final": true,
      "message": "No matching credit found — closing.",
      "reason_code": "NOT_RECEIVED"
    },
    "before": {
      "final": false,
      "message": "Blurry receipt — re-upload.",
      "reason_code": "UNREADABLE"
    }
  },
  "created_at": "2026-10-02T11:20:29.483Z"
}
(pass) close/dismiss audit entries — before/after reject snapshots (A7) > closing a NEEDS_RESUBMIT order: the audit records the PREVIOUS rejection and the NEW close reason (before/after) [1918.34ms]
(pass) close/dismiss audit entries — before/after reject snapshots (A7) > dismissing an EXPIRED order with a PENDING (late) proof: before is the null snapshot, after is the dismiss reason [1682.87ms]
(pass) REJECTED email-job dedupe keys (B) > attempt-<n> keys for two different attempts BOTH exist; the SAME key cannot duplicate (unique index backstop) [2004.15ms]

tests\phase3b\unit-tokens.test.ts:
(pass) QR token module (Ed25519, 05) > valid token verifies and round-trips ticket_id + event_id [226.74ms]
(pass) QR token module (Ed25519, 05) > tampered payload → bad_signature (signature covers the payload) [1.33ms]
(pass) QR token module (Ed25519, 05) > tampered signature → bad_signature [0.69ms]
(pass) QR token module (Ed25519, 05) > truncated signature → malformed [0.61ms]
(pass) QR token module (Ed25519, 05) > wrong kid → unknown_kid (before any signature math) [0.34ms]
(pass) QR token module (Ed25519, 05) > wrong version → bad_version [0.42ms]
(pass) QR token module (Ed25519, 05) > truncated / garbage input → malformed, never throws [0.28ms]
(pass) QR token module (Ed25519, 05) > wrong event: signature is valid but event_id inside the payload differs — the caller's event check catches it (05 verification order) [123.74ms]
(pass) QR token module (Ed25519, 05) > multiple public keys: old kid keeps verifying after rotation (extra keys via TICKET_SIGNING_PUBLIC_KEYS_JSON) [209.91ms]
(pass) Derived status token (02 v2.1) > derived token verifies; recomputation is deterministic [0.66ms]
(pass) Derived status token (02 v2.1) > wrong token (one char changed) fails [0.18ms]
(pass) Derived status token (02 v2.1) > right token, wrong order id fails [0.15ms]
(pass) Derived status token (02 v2.1) > right token, wrong version fails (bumping the version invalidates old links) [0.23ms]
(pass) Derived status token (02 v2.1) > malformed/truncated tokens fail without throwing [0.24ms]
(pass) Derived status token (02 v2.1) > comparison is constant-time by construction: the derived HMAC is always 32 bytes, compared with timingSafeEqual (32 vs 32); non-32-byte inputs are rejected on length, which is not secret [0.20ms]
(pass) Local storage signed URLs > sign → verify round-trips [0.41ms]
(pass) Local storage signed URLs > expired signature → expired (checked against wall clock) [0.17ms]
(pass) Local storage signed URLs > tampered signature → bad_signature (constant-time compare on the digest) [0.22ms]
(pass) Local storage signed URLs > signature for a different key/path → bad_signature [0.18ms]

 112 pass
 0 fail
 65 expect() calls
Ran 112 tests across 8 files. [178.52s]
Phase 3b runner exit: 0
waiting for server to shut down........................................... done
server stopped
Cleanup complete: owned app and database stopped; temporary fixture removed.

```

## Complete Phase 3b + Phase 4 output

```text
Phase 4 + Phase 3b: all files; real HTTP/PostgreSQL/sharp/PDF; capture/fake transport; injected clock/backdated rows.
Fixture: isolated loopback PostgreSQL; root .env is untouched.
waiting for server to start.... done
server started
Prisma schema loaded from prisma\schema.prisma

✔ Generated Prisma Client (v6.19.2) to .\node_modules\@prisma\client in 582ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints

Prisma schema loaded from prisma\schema.prisma
Datasource "db": PostgreSQL database "silentrave_test", schema "public" at "127.0.0.1:62028"

2 migrations found in prisma/migrations

Applying migration `20260930000000_v2_1_baseline`
Applying migration `20261002000000_phase4_email_state`

The following migration(s) have been applied:

migrations/
  └─ 20260930000000_v2_1_baseline/
    └─ migration.sql
  └─ 20261002000000_phase4_email_state/
    └─ migration.sql
      
All migrations have been successfully applied.
✔ OWNER account created: owner@silentrave.ng (Fixture Owner) — id c06b5430-0f4e-417a-8f21-e64b78c98ddf
  Log in at /admin (or admin.localhost).
✔ dev fixture event created: dev-fixture-silent-rave (Early Bird ×30 @ ₦5,000, Regular ×50 @ ₦10,000 — confirmed date)
✔ dev fixture payment account created (active)
Fixture app ready; login compiled; strict Origin checks; dedicated app port.
bun test v1.3.14 (0d9b296a)

tests\phase3b\authz.test.ts:
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/payments → 401 [92.80ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/payments → 403 [106.85ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/payments → 200 [218.29ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/orders/__ID__ → 401 [90.74ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/orders/__ID__ → 403 [101.84ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/orders/__ID__ → 200 [1282.04ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous GET /api/admin/payment-accounts → 401 [134.25ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF GET /api/admin/payment-accounts → 403 [105.84ms]
(pass) authorization — STAFF and anonymous vs every admin route > OWNER GET /api/admin/payment-accounts → 200 [171.26ms]
(pass) authorization — STAFF and anonymous vs every admin route > anonymous POST approve/reject → 401 (proxy gates before the route) [313.40ms]
(pass) authorization — STAFF and anonymous vs every admin route > STAFF POST approve/reject/payment-accounts → 403 [323.95ms]
(pass) authorization — STAFF and anonymous vs every admin route > the order is untouched by every rejected admin call above [11.54ms]
(pass) payment-accounts — password re-entry + at-most-one-active + audit > create + activate requires the OWNER's password; wrong password → 403 [1321.43ms]
(pass) payment-accounts — password re-entry + at-most-one-active + audit > PATCH edits with password re-entry, audits before/after, keeps one active [1924.49ms]
(pass) status tokens on order routes > status route: missing/wrong token and unknown code all 404 uniformly [1444.26ms]
A3 timing (ms): unknown code=183.8, wrong token=173.0, missing token=163.4
(pass) status tokens on order routes > proof route: unknown code, wrong token and missing token return the IDENTICAL status code and body, in comparable time (A3) [719.46ms]
(pass) signed proof-image URLs (owner-only, expiring) > valid signed URL + OWNER session → 200 image; without session → 401; tampered sig → 403 [678.00ms]
(pass) signed proof-image URLs (owner-only, expiring) > expired signed URL → 410 even with an OWNER session; non-proof namespace → 403 [266.46ms]
(pass) signed proof-image URLs (owner-only, expiring) > admin order detail mints short-lived signed URLs but never leaks the raw storage path [246.47ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST /api/auth/login with bad Origin → 403; missing Origin → 403 [262.89ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST approve with bad Origin → 403 and no state change [1317.76ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST reject with bad Origin → 403 [1216.70ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST payment-accounts with bad Origin → 403; PATCH with bad Origin → 403 [325.89ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > POST logout with bad Origin → 403 [214.94ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > same-origin requests still work (regression): login + logout round-trip [517.34ms]
(pass) Origin checks (06) — every state-changing admin/staff/auth route > GET admin routes do NOT require Origin (06 scopes the check to state-changing methods) [184.83ms]
(pass) Origin-check STRICT DEFAULT (A2) — ALLOW_DEV_ORIGIN is unset on this server > flag UNSET → strict: the ROOT host's Origin is NOT accepted on the admin surface (was the old dev relaxation) [1097.08ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > ALLOW_DEV_ORIGIN=1 set while NODE_ENV=production → startup REFUSES [193.61ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > flag UNSET in production mode → the guard passes (strict, boots normally) [155.54ms]
(pass) Origin boot guard (A2) — the startup assertion instrumentation runs > flag set in DEV mode → the guard passes (the opt-in is legal outside production) [155.60ms]
(pass) internal expire-holds guard > missing or wrong CRON secret → 401; correct secret → 200 [463.94ms]
(pass) order status endpoint content rules (03) > no PII beyond buyer-entered data; ticket list only when APPROVED; late_proof_received flag [139.41ms]

tests\phase3b\baseline-regressions.test.ts:
(pass) Imported baseline regressions > MAX_QTY_PER_ORDER applies to the whole order across multiple lines [300.61ms]
(pass) Imported baseline regressions > revive respects another buyer's reservation and returns CAPACITY_GONE without side effects [1101.58ms]
(pass) Imported baseline regressions > a sweep locks tiers globally across orders, avoiding a cycle with a multi-tier writer [546.62ms]

tests\phase3b\checkout.test.ts:
(pass) initialize — validation list (03) > happy path: 201, order code from the unambiguous alphabet, derived status token, server-side price [232.42ms]
(pass) initialize — validation list (03) > holder_names length mismatch → 400 [163.22ms]
(pass) initialize — validation list (03) > quantity over MAX_QTY_PER_ORDER (10) → 400 [144.81ms]
(pass) initialize — validation list (03) > tier belonging to a different event → 400 (VALIDATION) [504.81ms]
(pass) initialize — validation list (03) > DRAFT event → 409; unconfirmed date → 409 [448.10ms]
(pass) initialize — validation list (03) > sales window closed → 409 [469.97ms]
(pass) initialize — validation list (03) > no active payment account → 503 and nothing reserved [193.82ms]
(pass) initialize — atomic conditional reservation under concurrency > 8 parallel requests for the last 4 units: exactly 4 succeed, 4 get 409, CHECKs never violated [1846.43ms]
(pass) initialize — atomic conditional reservation under concurrency > single line exceeding availability → 409 with nothing partially reserved [179.39ms]
(pass) initialize — atomic conditional reservation under concurrency > multi-line order where ONE line fails → 409, the other line rolled back too [293.00ms]
(pass) initialize — abuse limits (04) > third unresolved order for the same EMAIL is refused (cap 2) [822.64ms]
(pass) initialize — abuse limits (04) > third unresolved order for the same PHONE is refused (cap 2), across different emails [913.50ms]
(pass) initialize — abuse limits (04) > resolved orders don't count toward the cap (an APPROVED order frees the email) [794.29ms]
(pass) initialize — abuse limits (04) > two different emails from the SAME IP are NOT blocked by any unresolved cap (IP is rate-only) [1095.41ms]
(pass) initialize — abuse limits (04) > per-IP RATE limit triggers at its threshold (default 10/hour) [2621.70ms]

tests\phase3b\closeout.test.ts:
(pass) A1 — initialize rejects ended events (03 v2.1.1: ends_at > now()) > ENDED event (PUBLISHED, date-confirmed, open sales window) → 409, nothing reserved [204.19ms]
(pass) A1 — initialize rejects ended events (03 v2.1.1: ends_at > now()) > event IN PROGRESS (starts_at past, ends_at future) → still purchasable (201) [250.15ms]
(pass) A6 — same-email CONCURRENT checkout cannot exceed the 2-unresolved cap > 5 PARALLEL initialize (same email, different tiers): exactly 2 succeed, 3 get 429, caps never exceeded [1336.78ms]
(pass) A4 — lookup rate limiting counts nonexistent codes; limited responses are identical > a NONEXISTENT code fills its own per-code bucket: 4th lookup of a fake code → 429 [1025.82ms]
(pass) A4 — lookup rate limiting counts nonexistent codes; limited responses are identical > after the threshold, an EXISTING code and a NONEXISTENT code get the IDENTICAL limited response [2611.97ms]
(pass) A5 — db:fixture refuses unsafe environments (guards run before ANY destructive step) > NODE_ENV=production → refuses (exit 1) before doing anything [164.98ms]
(pass) A5 — db:fixture refuses unsafe environments (guards run before ANY destructive step) > DATABASE_URL pointing at a non-embedded Postgres → refuses (exit 1) before doing anything [142.10ms]
(pass) B — proof vs sweep racing on a hold-boundary order (no orphan PENDING proofs) > lapsed hold, proof upload and sweep in parallel: EXPIRED + released exactly once + ONE late-flagged PENDING proof [2410.27ms]

tests\phase3b\lookup.test.ts:
(pass) lookup — uniform 202 responses, no order data > matching and non-matching code/email give byte-identical 202 bodies [1117.28ms]
(pass) lookup — uniform 202 responses, no order data > malformed body → same generic 202 (no validation oracle) [463.44ms]
(pass) lookup — uniform 202 responses, no order data > no order data in any response payload [950.83ms]
(pass) lookup — STATUS_LINK jobs (match only, fresh keys, nothing sent) > job created ONLY on a match, with a fresh key each time [1143.36ms]
(pass) lookup — rate limits (per IP and per order code) > per-code limit triggers at its threshold (3/hour) [838.22ms]
(pass) lookup — rate limits (per IP and per order code) > per-IP limit triggers at its threshold (10/hour) [3215.33ms]

tests\phase3b\proofs.test.ts:
(pass) proof — file validation (magic bytes, size, dimensions) > non-image file → 422 [360.51ms]
(pass) proof — file validation (magic bytes, size, dimensions) > disguised file (renamed .jpg but wrong magic bytes) → 422 [417.37ms]
(pass) proof — file validation (magic bytes, size, dimensions) > oversized (> 4 MB) valid JPEG → 422 [530.26ms]
(pass) proof — file validation (magic bytes, size, dimensions) > absurd pixel dimensions → 422 [447.51ms]
(pass) proof — file validation (magic bytes, size, dimensions) > PNG and WebP accepted; stored re-encoded JPEG strips EXIF [1628.34ms]
(pass) proof — transfer reference & duplicate handling > duplicate LIVE transfer_reference → 409 + system audit PROOF_DUPLICATE_REFERENCE_ATTEMPT, no row [1024.50ms]
(pass) proof — transfer reference & duplicate handling > duplicate image (same sha256, different order) → FLAGGED, not blocked [971.33ms]
(pass) proof — transfer reference & duplicate handling > idempotent retry with the same client_submission_id creates no second attempt [757.60ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > no proof in 15 min → sweep sets EXPIRED + releases; second sweep is a no-op [687.94ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > proof submitted → hold becomes first_proof_at + 48h and does NOT move on resubmission [2008.73ms]
(pass) proof — hold policy (04 'Hold policy (locked)') > wrong/missing status token and unknown code on the proof route are INDISTINGUISHABLE (A3: uniform 404) [910.75ms]
(pass) proof — LATE proofs (04 'Late proofs') > within grace → recorded PENDING with flags.late, order STAYS EXPIRED, inventory untouched, in queue, revivable [2580.99ms]
(pass) proof — LATE proofs (04 'Late proofs') > outside grace (hold_expires_at + 24h) → 410 [534.45ms]
(pass) proof — LATE proofs (04 'Late proofs') > a SECOND late proof is rejected [1091.10ms]

tests\phase3b\review.test.ts:
(pass) approveOrder — concurrency and idempotency > double-click + two admins racing: ONE transition, sold incremented once, exactly N tickets, ONE TICKETS job [1540.94ms]
(pass) approveOrder — concurrency and idempotency > approve on a CANCELLED event → EVENT_CANCELLED, nothing changed [946.34ms]
(pass) approveOrder — concurrency and idempotency > approve requires confirmed_in_bank: true [1133.65ms]
(pass) approveOrder — concurrency and idempotency > approve vs reject racing on the same PROOF_SUBMITTED order: exactly ONE wins, the loser gets a clean INVALID_STATE, inventory consistent [1134.23ms]
(pass) approveOrder — concurrency and idempotency > approve vs sweep racing on an order at its hold cap: consistent final state, inventory never negative, no double release [1597.11ms]
(pass) full lifecycles > initialize → proof → approve: statuses, inventory, emails, audit [1315.43ms]
(pass) full lifecycles > initialize → proof → reject(resubmittable) → resubmit ×3 → fourth rejection exhausted → REJECTED, inventory released once [3866.63ms]
(pass) full lifecycles > OWNER closing a NEEDS_RESUBMIT order → REJECTED and inventory released once (fresh close-<n> email key) [1698.27ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > revive with capacity: EXPIRED + PENDING proof → APPROVED, re-reserves atomically [1149.84ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > revive WITHOUT capacity → CAPACITY_GONE rollback, then dismiss → REJECTED final, releases nothing [2867.98ms]
(pass) revive rules (04 + CHANGELOG v2.1 item 4) > an order that expired from NEEDS_RESUBMIT is NOT revivable (no PENDING proof) [1567.21ms]
(pass) sync_seq trigger (02 v2.1) > changes on INSERT (mint) and UPDATE (check-in, void); monotonic per statement [1381.12ms]
SAMPLE CLOSE AUDIT ROW:
{
  "id": "fc235904-318a-485d-97ad-d47f5e3e60d5",
  "actor_id": "c06b5430-0f4e-417a-8f21-e64b78c98ddf",
  "action": "ORDER_REJECTED",
  "entity_type": "order",
  "entity_id": "f67d7cf1-6a72-4ff1-8fa8-694133100674",
  "metadata": {
    "to": "REJECTED",
    "from": "NEEDS_RESUBMIT",
    "after": {
      "final": true,
      "message": "No matching credit found — closing.",
      "reason_code": "NOT_RECEIVED"
    },
    "before": {
      "final": false,
      "message": "Blurry receipt — re-upload.",
      "reason_code": "UNREADABLE"
    }
  },
  "created_at": "2026-10-02T12:04:29.403Z"
}
(pass) close/dismiss audit entries — before/after reject snapshots (A7) > closing a NEEDS_RESUBMIT order: the audit records the PREVIOUS rejection and the NEW close reason (before/after) [1044.32ms]
(pass) close/dismiss audit entries — before/after reject snapshots (A7) > dismissing an EXPIRED order with a PENDING (late) proof: before is the null snapshot, after is the dismiss reason [1077.54ms]
(pass) REJECTED email-job dedupe keys (B) > attempt-<n> keys for two different attempts BOTH exist; the SAME key cannot duplicate (unique index backstop) [1701.23ms]

tests\phase3b\unit-tokens.test.ts:
(pass) QR token module (Ed25519, 05) > valid token verifies and round-trips ticket_id + event_id [0.78ms]
(pass) QR token module (Ed25519, 05) > tampered payload → bad_signature (signature covers the payload) [0.72ms]
(pass) QR token module (Ed25519, 05) > tampered signature → bad_signature [0.68ms]
(pass) QR token module (Ed25519, 05) > truncated signature → malformed [0.63ms]
(pass) QR token module (Ed25519, 05) > wrong kid → unknown_kid (before any signature math) [0.21ms]
(pass) QR token module (Ed25519, 05) > wrong version → bad_version [0.24ms]
(pass) QR token module (Ed25519, 05) > truncated / garbage input → malformed, never throws [0.15ms]
(pass) QR token module (Ed25519, 05) > wrong event: signature is valid but event_id inside the payload differs — the caller's event check catches it (05 verification order) [0.42ms]
(pass) QR token module (Ed25519, 05) > multiple public keys: old kid keeps verifying after rotation (extra keys via TICKET_SIGNING_PUBLIC_KEYS_JSON) [2.59ms]
(pass) Derived status token (02 v2.1) > derived token verifies; recomputation is deterministic [0.66ms]
(pass) Derived status token (02 v2.1) > wrong token (one char changed) fails [0.19ms]
(pass) Derived status token (02 v2.1) > right token, wrong order id fails [0.16ms]
(pass) Derived status token (02 v2.1) > right token, wrong version fails (bumping the version invalidates old links) [0.26ms]
(pass) Derived status token (02 v2.1) > malformed/truncated tokens fail without throwing [0.29ms]
(pass) Derived status token (02 v2.1) > comparison is constant-time by construction: the derived HMAC is always 32 bytes, compared with timingSafeEqual (32 vs 32); non-32-byte inputs are rejected on length, which is not secret [0.19ms]
(pass) Local storage signed URLs > sign → verify round-trips [0.40ms]
(pass) Local storage signed URLs > expired signature → expired (checked against wall clock) [0.26ms]
(pass) Local storage signed URLs > tampered signature → bad_signature (constant-time compare on the digest) [0.27ms]
(pass) Local storage signed URLs > signature for a different key/path → bad_signature [0.16ms]

tests\phase4\config.test.ts:
(pass) config is fail-closed; capture cannot run in production; origins have no credentials/path [13.09ms]
(pass) backoff schedule has bounded jitter and errors contain no provider content [0.88ms]

tests\phase4\directions.test.ts:
(pass) directions prefers place id, then coordinates, then safe URL, then null [0.62ms]

tests\phase4\kick.test.ts:
(pass) best-effort kick swallows worker failure; fixture flag disables automatic sends [0.71ms]

tests\phase4\pdf.test.ts:
(pass) PDF embedded diacritics/text/Lagos offset and exact stored QR decode, >=40mm active symbol [3066.61ms]
(pass) PDF cached second request; venue/directions/date edits regenerate; never stale [4029.67ms]

tests\phase4\routes.test.ts:
(pass) PDF authz: unknown order/ticket, wrong order/token and missing token are identical 404; headers/status links [5194.09ms]
(pass) refund voids all units and bumps sync_seq; restock/audit; repeat/concurrent refund restocks once [6556.48ms]
(pass) refund restock=false preserves sold; undercount clamp never negative; non-approved 409 [3489.06ms]
(pass) checked-in refund needs acknowledgement, then succeeds with audit [2146.67ms]
(pass) refund/resend OWNER matrix: STAFF 403, anonymous 401, bad Origin 403; password re-entry [2693.64ms]
(pass) resends fresh keys/order recipient/audits; sixth in sliding hour rate-limited; rejects recipient input [2737.16ms]
(pass) concurrent resend limit across requests admits exactly five [1830.02ms]
(pass) owner email-jobs filters/pagination and order-detail jobs contain no links/tokens/private payload [1813.01ms]

tests\phase4\templates.test.ts:
(pass) all React Email kinds render HTML/text, valid status links, no bank details/buyer subjects [1975.97ms]

tests\phase4\transport.test.ts:
(pass) direct transport sends stable idempotency header, job tag, base64 attachments and timeout [1.58ms]
(pass) transport classifies 500/422/429/quota/concurrent-key; errors never retain provider messages [2.09ms]
(pass) Retry-After supports seconds/date and capture returns same id for same payload [23.65ms]

tests\phase4\webhook.test.ts:
(pass) webhook valid signature/tag-before-message-id, replay no-op, bounce wins over delivery [1727.52ms]
(pass) webhook missing/invalid/stale/future signatures rejected; malformed JSON and oversized body [1686.83ms]
(pass) webhook raw-body tampering fails; array job_id tag matches before stored id [1092.68ms]
(pass) process endpoint wrong/missing CRON_SECRET 401; correct drains capture job [2725.07ms]

tests\phase4\worker.test.ts:
(pass) worker success QUEUED -> SENT, stores message id, attempts=1; only order recipient [1121.67ms]
(pass) worker transient 500 queues 1m backoff; MAX_EMAIL_ATTEMPTS fails [2058.82ms]
(pass) permanent 422 fails immediately; last_error excludes URLs/tokens/addresses [1041.56ms]
(pass) 429 Retry-After honoured; quota pauses batch and shared gate [1524.42ms]
(pass) crash after acceptance retries SAME key and payload, one effective send [2117.26ms]
(pass) two concurrent workers send each job once; shared spacing persists across invocations [2004.86ms]
(pass) stuck expired claim reclaimed; live lease skipped; refunded ticket job never sends [2122.26ms]
(pass) expired ownership after slow preparation blocks provider; no late batch lease send [885.11ms]
(pass) ambiguous outcomes after retention stop; immutable payload guards token rotation [3186.75ms]
(pass) webhook winning during send retains BOUNCED while message id is persisted [1633.61ms]
(pass) immutable retry payload refuses changed order recipient and ciphertext tampering [1930.86ms]

 145 pass
 0 fail
 342 expect() calls
Ran 145 tests across 17 files. [155.27s]
Phase 4 kick-failure HTTP acceptance: kicks enabled; invalid worker sender; no real sends.
Fixture app ready; login compiled; strict Origin checks; dedicated app port.
bun test v1.3.14 (0d9b296a)

tests\phase4-kick-failure.test.ts:
(pass) real HTTP approve/reject succeed with kicks enabled and worker configuration failure [5220.52ms]
(pass) missing configured CRON_SECRET/webhook secret fail closed over real HTTP [336.45ms]

 2 pass
 0 fail
 12 expect() calls
Ran 2 tests across 1 file. [5.91s]
Phase 4 + Phase 3b runner exit: 0
waiting for server to shut down.............................. done
server stopped
Cleanup complete: owned app and database stopped; temporary fixture removed.

```
