# Step 5 readiness/preflight report

Prepared 2026-10-03, Africa/Lagos. Scope: reversible local preparation and a
reviewable configuration/forward-migration/deployment plan. **Launch blocked;
hosted implementation and deployment are not complete.**

## Baseline and authorization

Read the complete Desktop Step 5 handoff and all current active v2.1.2 specs
(README, 01 through 07 and CHANGELOG). Rechecked repository/ancestor instructions:
no applicable AGENTS.md found. Memory supplied runner/locking cautions; current
workspace/GitHub state was independently verified. Initial tree was clean.

GitHub confirms PR #4 CLOSED/MERGED at 2026-10-03T13:14:25Z, squash commit
4e5e68b8927e1fa3e70254f364e4f3cda0d70adc. Local main and fetched origin/main
match it. Post-merge run [37125499610](https://github.com/tochigit/silent-rave/actions/runs/37125499610)
completed SUCCESS; Verify (linux) and Verify (win32) succeeded on that exact SHA.
This supersedes pre-merge wording in STEP4_REPORT.md, which is preserved intact.

Focused branch: `feat/step5-hosted-readiness` from that baseline. All four earlier
branches remain locally/remotely. No root .env or existing work was overwritten.
No permission for this PR's merge, hosted configuration/data/migrations, permanent
owner changes, real mail/push, purchases or deployment. This milestone includes
PR publication and then stops for review.

## Result and inventory

- Added `.docs/08-hosted-readiness.md`: actual adapters, proposed configuration,
  storage privacy and lifecycle, shared limiter design, Supabase Data API
  protection, exact host constraints, forward-only migration process, recovery,
  scheduler and device/live acceptance sequence. Linked it from the spec index.
- Added `scripts/readiness.ts`: offline environment syntax checks and exact
  SHA-256 migration inventory, with fixed redacted diagnostics. It does not
  import a runtime DB/storage adapter, read .env, contact a provider or write
  configuration. Launch remains false even for syntactically valid configuration.
- Added `scripts/preflight-db.ts`: existing guarded owned loopback fixture,
  migration-history/checksum verification, repeat deploy, independent transaction
  advisory/row/SKIP LOCKED exclusion, rollback/inventory and lock-release checks.
  Existing production transaction timeouts remain unchanged. No app starts.
- Added isolated readiness tests and package scripts `readiness`,
  `test:readiness`, `db:preflight`. Added the cheap readiness suite to both existing
  CI jobs, preserving standard lint, both types, 176-case full regression and
  production build. No dependency install/lockfile change.
- Updated the local .env.example's domain to the settled `silentrave.space` and
  documented scheduler constraints. Supabase adapter remains explicitly a stub;
  this PR cannot enable it just by setting STORAGE_DRIVER.
- Replaced stale current-state checkpoint notes on the new branch only.

Application sources, Prisma schema, migration SQL and all earlier tests remain
unchanged. No UI, auth, checkout, price/inventory, email/retry, QR/admission or
ledger behavior is altered. No browser acceptance rerun is needed for these
tooling/docs changes; earlier evidence remains tied to its original exact heads.

Code gaps remain: durable Supabase storage; shared serverless limits; private
business-table Data API exposure protection. Realtime has no shared transport;
the shipped mandatory polling remains the correctness fallback. The storage
plan retains OWNER + application signature + expiry for proof reads; exposing a
Supabase bearer signed URL would weaken that contract and is not the plan.

## User launch information and provider findings

The user said resources will be created once requested after preparation, and
selected **plan a free external scheduler**. No ownership/project/region/existing
hosted data or sender verification has been established. Do not ask for credentials
in chat. Resource setup requests belong after the next local readiness milestone
and concrete host choice; their creation is not assumed here.

The user asked about Netlify Free. Official provider documentation was checked
on 2026-10-03 and linked in the plan. Findings:

- Vercel Hobby's non-commercial restriction conflicts with paid-event launch;
  daily-only cron cannot meet minute processing. No paid upgrade is authorized.
- Netlify Free permits commercial projects and standard cron schedules, but
  has 300 shared monthly credits and pauses when they are exhausted. Current
  credit-based pricing replaces old free quotas for new accounts.
- Netlify scheduled functions run for 30s; the existing worker budget is 45s.
  Its standard synchronous function ceiling is 60s. An external scheduler or
  bounded background wrapper is needed. No wrapper has been implemented.
- Next 16 proxy imports Prisma native-engine/session logic. Netlify documents
  Node middleware addon/filesystem restrictions: actual adapter compatibility
  is UNVERIFIED and must precede host selection. Do not bypass auth to adapt it.
- Both candidates have practical binary upload limits near 4.5 MB. Multipart
  overhead and current 5 MiB envelope must be measured on the selected host.
- Cloudflare Workers Free cron is the proposed external scheduler. Provider
  docs support the minimal two-POST design within CPU/network/wall-time limits;
  account creation, scheduling and runtime metrics are not verified.
- Supabase DB backups exclude stored object bytes; off-site DB/object recovery
  is required. Business tables currently lack migration RLS/revokes and need
  deliberate Data API protection before hosted exposure.
- Resend sender DNS, 40MB encoded-attachment ceiling, signatures/replays and
  provider quota need staged acceptance. No provider requests/messages occurred.
- Places needs attribution/content-retention/restriction work before enabling
  its server key. Physical VAPID/push/camera/iOS/offline/gates remain unverified.

Netlify is an evaluated candidate, not a silently selected/deployed replacement.
Pricing/limits must be rechecked before eventual deployment.

## Validation

Complete local output is retained in `reports/step5-*`; sources were frozen
during their final checks. Existing historical reports/outputs are unchanged.

| Check | Result |
|---|---|
| Final readiness tests | PASS: 7 tests, 0 fail, 50 expectations; exit 0. Initial 6-case output also retained. |
| Disposable DB preflight | PASS: 4 checks; exit 0; owned cleanup complete. |
| Application + tooling TypeScript | PASS: standard package command, both configs; exit 0. |
| Changed-tool lint | PASS: same repository ESLint config/rules, invoked directly under Bun; exit 0. |
| Offline readiness CLI | Expected BLOCKED: exit 1, configurationValid=false, readyForLaunch=false, four fingerprints. Inspection worked; this is not a launch pass. |
| Diff/secret/process review | PASS: final staged review and diff check, no task-owned node/bun/postgres processes, root .env absent. |
| Current-head PR CI | Pending publication. |
| Hosted/provider/physical behavior | UNVERIFIED, not performed. |

DB preflight used PostgreSQL 18.4's embedded package and the complete four-file
forward chain. It checked file bytes against `_prisma_migrations`, all completed
with no rollback marker. Repeat deploy reported no pending migrations and kept
the disposable owner hash/active/password-reset state unchanged. Two independent
Prisma clients demonstrated transaction advisory lock exclusion and SKIP LOCKED
against a held tier row. Intentional rollback restored reserved count and
released advisory/row locks. These checks cannot establish real pooler behavior,
Supabase permissions or existing hosted migration history.

Full local baseline regression/build/lint were not repeated for unchanged app
sources. Current main CI independently passed the full baseline on both platforms;
new PR CI retains the same required checks. Stopped checks would be incomplete,
not passed. Both local type configs passed; no check has been weakened.

Commands and outputs:

| Command | Complete output |
|---|---|
| `bun --no-env-file run test:readiness` | reports/step5-readiness-tests-final.txt |
| `bun --no-env-file run db:preflight` | reports/step5-win32-db-preflight.txt |
| `bun --no-env-file run typecheck` | reports/step5-typecheck.txt |
| `bun --no-env-file node_modules/eslint/bin/eslint.js scripts/readiness.ts scripts/preflight-db.ts tests/step5/readiness.test.ts` | reports/step5-changed-tools-lint.txt |
| `bun --no-env-file run readiness` | reports/step5-offline-readiness.json and step5-offline-readiness-result.json |
| GitHub baseline state read | reports/step5-baseline-github.json |

PowerShell's initial test/types captures render Bun stderr command announcements
as NativeCommandError records. Actual processes exited 0; these are formatting
artifacts, not failed assertions. Final tests include the explicit exit code.
No stalled/stopped local check is claimed passed in this milestone. Readiness
exit 1 is recorded as blocked; the wrapper verified that expected result.
Tracked new evidence is UTF-8 with trailing whitespace normalized; original
capture bytes are preserved locally in .test-runtime/step5-raw-evidence. The
initial staged diff check flagged a whitespace-only Prisma output line; the
normalized evidence passed. No output message or failure was removed.

## Git publication and next action

Implementation/publication head, focused PR and exact-head CI will be recorded
after publication. The final head/check state belongs in the PR description to
avoid a self-referential committed hash. Local main remains the merged Step 4
baseline. No branch deletion, merge or deploy occurs during this milestone.

Stop for user review. After a separately approved merge/continuation, the proposed
next local Step 5 milestone is durable storage/shared limits/Data API protection
and compatibility work for the chosen host, with full regression after application
changes. Hosted provisioning/migration/deployment and real delivery each need
their concrete reviewed plan and explicit approval. Preserve one offline scanner
for the entire event during outages, permanent owner identity, and existing keys.
