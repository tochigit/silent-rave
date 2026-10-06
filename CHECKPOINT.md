# Silent Rave checkpoint

2026-10-07, Africa/Lagos. **Batch A IN PROGRESS: uploads and durable storage.**

Current branch: `feat/step5c-upload-storage`, from verified merged main/origin/main
`0da2051ca9c617fbe09d50cabcd2e2232045fd9f`. PR #6 is merged; exact post-merge
CI 37540660015 passed Windows/Linux, confirmed live before this branch was created.
All earlier branches/fixtures/reports remain preserved. Initial working tree clean;
no owned Node/Bun/Postgres/pg_ctl processes at preflight; no applicable AGENTS.md.

Read the entire Desktop Consolidated continuation, Step 5B plan, Step 5C1 handoff,
this checkpoint and doc 09. Consolidated Batch A supersedes the separate 5C.2/5C.3
PR boundaries. Authorized: local implementation, controlled disposable/fake-provider
checks, additive migration authoring/replay, progress checkpoints and ONE focused PR.
Stop for review after publication. No merge or Batch B; no hosted queries/writes,
bucket setup/import/deletion, DNS/deployment/purchases/real sends/owner changes.

Implemented, awaiting acceptance: shared 3 MiB/3.25 MiB request/output limits,
bounded multipart reader, Sharp sanitation, browser preparation/retry feedback,
Supabase HTTP adapter and typed no-overwrite/collision/failure behavior, shared
application signatures, immutable first-writer PDFs, additive storage ledger/linkage
and OWNER dry-run lifecycle report. Doc 10 describes configuration and legacy gates.
New tests cover boundaries, real images/PDF concurrency, provider faults, privacy,
retries/accounting and backfill/public-role denial. Final Node ZIP acceptance now
uses fake Storage HTTP, with application-signed proof reads and linked accounting.

Local Bun Prisma generation STALLED and was stopped; it is incomplete. Supported
Node 24 generation subsequently PASSED. Types/checks and draft publication are
currently pending, never claimed passed. Windows command/module startup is unusually
slow. Next: finish type/lint/focused checks; resolve failures, publish draft CI if
needed; migration/backfill/native/full Windows/Linux acceptance and browser checks;
then exact-head evidence/docs/handoff and ONE completed PR, STOP FOR REVIEW.
Supabase/Postgres/UI and branch/checkpoint skills read; current public docs/changelog
reviewed without accessing hosted data. readyForLaunch=false remains intentional.

## Historical Step 5C.1 checkpoint (superseded merge/review state)

Step 5C.1 COMPLETE; PR #6 subsequently merged as recorded above.
Netlify runtime/auth adaptation is implemented and verified in Windows/Linux CI.
PR #6: https://github.com/tochigit/silent-rave/pull/6
Branch: `feat/step5c1-netlify-runtime-auth`; base main remains
`3b69187d017403fb84777f9c3406c68bb3e96a55`. All prior branches are preserved.
No merge, deletion, Step 5C.2 or hosted rollout was performed or authorized.

## Implementation

Pinned OpenNext 5.16.2 runs before our inspected ingress build plugin. The plugin
prepends signed ingress to the generated integration manifest before bundling,
rejects unknown contracts and checks final edge-bundler 16.1.2 routing. Generated
Next handlers remain intact. Hash-guarded CJS URL/path and virtual-cwd corrections
allow Windows Deno compilation while retaining Linux behavior. Lifecycle entry
exports are separate from helpers. Adapter upgrades require repeat acceptance.

The proxy is native-free and calls a strict secret-gated Node broker at its own
immutable deployment. Ingress strips reserved/bypass/debug assertions and signs
platform origin/IP/deployment/method/path context. Node page/API guards independently
verify live activity, role and temporary-password state. Renewal uses DB time,
user-before-session locks, conditional expiry extension and a live postcheck.
Strict full Origins, future/encoded/dotted/RSC route protection, bounded eight-second
broker calls and private browser/CDN headers preserve the central auth boundary.

The build removes runtime/provider/owner/fixture secrets and rejects dotenv files;
only unreachable loopback database placeholders enter framework compilation.
Next 16.1.3, Prisma 6.19.2, Sharp 0.34.5, Node 24 and Bun 1.3.14 are retained.
Trace exclusions keep tooling/fixtures/local storage out; explicit native libraries
and Noto/OFL stay in Node packages. Scanner assets remain unchanged in behavior.

## Acceptance and publication evidence

Implementation head `5ca3b08d782bb944044e4582fe12158b08747789` passed both complete
jobs and GitGuardian in [CI 37533098994](https://github.com/tochigit/silent-rave/actions/runs/37533098994).
Saved evidence is under `reports/step5c1-ci-37533098994/{linux,win32}/`.
The final documentation publication HEAD and exact-head checks are recorded in
PR #6 and the Desktop handoff; verify them live rather than treating this parent
implementation run as proof of a later unverified change.

Both systems passed standard lint, both TypeScript configurations, readiness and
8 policy tests, guard coverage, scanner generation, actual offline Netlify builds,
final Edge ordering, native-free traces and build-canary/dotenv scans. Generated
ingress/adapter handlers executed in supported Deno; Node verified their transferred
HMAC context, rewrite and stream behavior. Isolated final function ZIPs executed
outside repository module resolution with real native Prisma queries, Sharp proof
uploads/EXIF stripping, live guards/broker and PDF font/license/diacritics/Lagos date/
exact stored QR decoding. Framework cache and platform context were synthetic.

Full suites passed **183 cases per OS: all 176 baseline regressions plus six
runtime/auth/race cases and one database-outage case**. Owned app/database cleanup
passed. Missing keys, malformed input/replies, forwarding/bypass attempts, unknown
hosts, role/password/activity transitions and concurrent renewal/expiry/logout/
deactivation fail closed. Hosted execution of packaged Edge bundles is unverified.

Local Windows lint under Bun, both types, 8 policy tests and guard audit passed;
a supported-Deno virtual chunk probe passed. The focused real HTTP/Postgres rerun
passed 6 cases and 249 assertions, including cleanup; its report is saved under
`reports/step5c1-focus-win32-test-output.txt`. Earlier PC-interrupted/stalled/failed local
attempts are historical, never passes. Local dependencies were restored with
locked offline npm and Prisma generation after repeated Bun install/copy failures.
The checksum-verified ignored Node 24.21.0 tool is optional; global Node 26 was
unchanged. Interrupted owned scratch `run-Ic8nsc` is preserved; use fresh fixtures.

## Stop boundary and next step

Root dotenv remains absent; no hosted query/SQL/configuration/migration, DNS,
deployment, real email/push or permanent owner/password change occurred. Original
migrations were replayed only in disposable loopback fixtures. Supabase MCP and
skills were authenticated/installed earlier, without hosted data access here.
Provider variable scopes, immutable deployment origin and hosted runtime still
need future setup/smoke tests. `readyForLaunch=false` remains intentional.

Review PR #6. Merge only with explicit approval, preserving its branch. Do not
automatically begin another milestone. Remaining Step 5B sequence: 5C.2 upload
limits; 5C.3 durable storage; 5C.4 shared limits; 5C.5 scheduler/mail budgets;
5C.6 database privacy, polling and release preparation. Each has its own branch,
verification and review. Hosted setup and launch remain separately authorized.

Resume from the full Desktop `Silent Rave - Step 5C1 Netlify continuation.md`,
current doc 09, Step 5B plan, Git/PR/checks and owned process state. GitHub REST
helper is ignored `.test-runtime/github-api.ps1`; JSON requests use UTF-8 without
BOM. Preserve unrelated processes and never output credentials or private transfers.

---

## Historical Step 5 checkpoint (2026-10-03; superseded by current status above)

Updated 2026-10-03, Africa/Lagos. Specifications: .docs v2.1.2.

1. Baseline COMPLETE; PR #1 merged at 982eb9f.
2. Email/PDF/refund backend COMPLETE; PR #2 merged at 7fcf42d.
3. Customer experience COMPLETE; PR #3 merged at 8984f9e.
4. Owner/staff/offline scanner COMPLETE; approved PR #4 squash-merged at
   4e5e68b8927e1fa3e70254f364e4f3cda0d70adc on 2026-10-03T13:14:25Z.
5. Readiness/preflight and reversible local preparation COMPLETE; PR #5 OPEN,
   STOPPED FOR REVIEW. Hosted launch remains blocked.
   Hosted implementation/configuration/migration/deployment remain pending.

## Authorized scope and current state

Read the entire Desktop Silent Rave - Step 5 continuation.md. It supersedes
historical pre-merge Step 4 report language. Live GitHub verification confirmed
PR #4 merged and post-merge main CI 37125499610 successful on Linux and Windows.
Main/origin/main are 4e5e68b. Initial working tree was clean; no applicable
AGENTS.md found in repository/ancestors. All earlier branches retained.

Current branch: feat/step5-hosted-readiness, from that verified main.
PR #5: https://github.com/tochigit/silent-rave/pull/5 (base main).
Verified local implementation head: 502f8e2655bec81e9635c857a68553ba9ce56166.
Final documentation publication head/current-head CI are recorded in PR #5's
description to avoid a self-referential committed hash. Verify them live.
Scope: local readiness tools/plan, appropriate validation, checkpoint/report,
focused PR publication, then STOP FOR REVIEW. No merge, hosted writes/migrations,
permanent owner changes, real mail/push or deployment authorized.

User says launch resources will be created when requested after preparation;
ownership/projects/regions/sender verification are not established. User chose
planning a free external scheduler. Netlify Free is an evaluated candidate after
the user's question; host choice has not been changed. Vercel Hobby commercial
use restrictions and daily cron are confirmed launch blockers. No purchase or
paid upgrade authorized.

## Local preparation and checks

- Plan: .docs/08-hosted-readiness.md. Distinguishes code gaps from external setup,
  storage/session privacy, shared limits, Supabase Data API, hosted migration/
  recovery, host compatibility, scheduler and physical acceptance.
- Offline redacted checker/fingerprints: scripts/readiness.ts. Exit 1 is expected
  while launch is blocked, even with syntactically valid candidate configuration.
- Disposable database probe: scripts/preflight-db.ts. Existing guarded fixture
  only; no app/provider; existing transaction limits retained.
- Final readiness suite: 7 pass/0 fail/50 expectations, exit 0. Covers safe
  diagnostics, origins, pooler split, secret keys, fixtures and migration inventory.
  Initial 6-case output retained separately.
- Database probe PASSED all four checks; exit 0 and owned cleanup complete.
  Fresh chain/checksums, repeat deploy preserving fixture owner, independent
  advisory/row/SKIP LOCKED locks, rollback/inventory and lock release.
  Evidence: reports/step5-win32-db-preflight.txt.
- Both TypeScript configurations PASSED, exit 0. Changed-tool ESLint under Bun
  PASSED, exit 0, same repository config/rules. Offline audit returned expected
  exit 1, configurationValid=false, readyForLaunch=false, four fingerprints.
- Diff check PASSED. Final process inventory empty; root .env remains absent.
  PR #5 published. Exact-head CI pending; verify live via its description/checks.
- Application code, dependency locks and migration SQL unchanged. Reuse verified
  post-merge baseline CI; do not repeat installs/full local checks for unchanged
  evidence. Existing CI retains full regression/build checks.

Root .env absent/untouched. Owned disposable database stopped and directory
removed. No app/browser/provider process started. Preserve historical logs,
branches and unrelated processes. Verify live process state on resume.

## Remaining action and boundary

Next action: USER REVIEW of PR #5 and its exact-head checks. Full report:
.docs/STEP5_REPORT.md. Plan: .docs/08-hosted-readiness.md. STOP FOR REVIEW.
No approval for merge or further hosted/local implementation. On resume read
these documents and the Desktop Step 5 handoff; inspect Git/PR/CI/process state.
After review, suggested next separately authorized local milestone is durable
storage/shared limits/Data API protection with chosen-host compatibility.
