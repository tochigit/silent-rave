# Step 3 customer experience report

ACTIVE, incomplete. Branch feat/step3-customer-experience, base main 7fcf42d.
Only customer experience authorized. No merge, later step or deployment.

## Start and preflight

Complete external Step 3 handoff and .docs v2.1.2 read. Fetched main matches
7fcf42d8fb13e5f77ce6f8db8fe613987e591670; clean tree at start; all branches retained.
No applicable AGENTS.md found. Old checkpoint/report open-PR statements historical.

Historical merge-head CI attempt 1: Linux pass; Windows 144 pass/1 fail, future
webhook timestamp expected 401, received 404; separate app/build skipped.
Attempt 2 reran Windows unchanged and passed. Rerun did not fix fixture.
This branch uses +/-360,000ms. No verifier change, sleeps, masked retries or
weakened assertions. Focused check active; disposable database initializing.

## Contract decisions

- API 03 controls CTA: confirmed published not-ended events, starts_at order,
  ties on Africa/Lagos calendar day; then unconfirmed fallback.
- About/Contact owner editable: minimal forward content migration and disposable
  seeds here; editing UI Step 4.
- Public description/content escaped text; no untrusted HTML execution.
- Local fixtures explicitly fake; real event/bank/contact/service data unknown.

## Verification

Local first focused preflight: INCOMPLETE, no tests ran. PostgreSQL initialization
and cold Prisma/Next startup were unusually slow; Next ready after 211.6s, app
readiness exceeded the 300s budget. Cleanup succeeded. Complete saved output:
reports/step3-preflight-first-run-incomplete.txt.

Second focused attempt: INCOMPLETE, explicitly stopped before readiness while
the application/schema changed. No assertion result claimed. Its PostgreSQL fast
shutdown exceeded 120s; must verify the owned cluster stopped before cleanup.
Complete output reports/step3-preflight-second-run-incomplete.txt. Initial local
TypeScript attempt was stopped while loading and is INCOMPLETE, never a pass.
Readiness budget increased to 600s for cold Windows compilation only; test
timeouts/assertions and verifier unchanged. Future checks use a stable code tree.

Browser plugin bootstrap first timed out; retry initialized but reported no
browser, discovery returned []. Desktop fallback reported native pipe unavailable.
Standalone playwright-core installed only in ignored .test-runtime/browser-check
for the installed Chrome fallback; repository dependency locks untouched.

Application TypeScript passed using direct Bun/tsc (exit 0), after Prisma
generation passed. Tooling TypeScript found four test typing errors: nullable
expected recipient, reject service object signature, refund acknowledgement.
Corrected; final both checks still required. Formatting first command had a
Windows glob miss for `(public)`; second explicit directory pass succeeded.

Public implementation and 15 new fixture-backed API/service cases now written.
Focused webhook run restarted on the stable implementation/schema (three forward
migrations). No assertion pass claimed until runner exits. Full 147-case
regression, new cases, lint, build, browser and CI still pending.

Second incomplete run's database later stopped normally at 19:45 WAT; pid file
absent and no PostgreSQL process remains. Saved complete shutdown log in
reports/step3-preflight-second-shutdown.txt. Automatic approval review rejected
recursive deletion of that stopped owned directory; it remains ignored at
.test-runtime/run-1jNjwR. No unrelated process or historical fixture was removed.

Hosted acceptance stays unverified. Browser must exercise actual customer UI.

Third focused attempt: INCOMPLETE, no tests ran. Root CSS compilation exposed
Next propagating Bun's `--no-env-file` from `process.execArgv` to `NODE_OPTIONS`.
Its Node PostCSS worker rejected the Bun-only flag (exit 9). Complete runner
output: reports/step3-preflight-third-run-incomplete.txt. Next now runs under
Node with the explicit fixture environment; Bun fixture/test runners still use
`--no-env-file`. Applied the same compatibility fix to Phase 3b and interactive
fixture launchers. Production dependencies/verifier remain pinned/unchanged.
Owned third app/database cleanup passed. Fourth focused attempt active.
Owned PostgreSQL shutdown budget now 300s because the second native filesystem
sync took 162s; this changes neither test assertions nor production timing.

Fourth focused attempt: INCOMPLETE, readiness timed out before assertions after
600s of CSS compilation under installed Node 26.5.0; owned app/database cleanup
passed. Complete output reports/step3-preflight-fourth-run-incomplete.txt.
Fifth focused run uses already available Node 24.20.0 LTS through task-scoped PATH,
not a global install or app dependency upgrade. CI explicitly selects Node 24.
Tailwind source detection is scoped to src rather than reference/evidence files
([official syntax](https://tailwindcss.com/docs/detecting-classes-in-source-files)).
No successful check inferred from these infrastructure adjustments.

Fixture initialization now skips initialization-only fsync on its newly created
disposable cluster (`initdb --no-sync`), avoiding repeated cold Windows sync
delays. Runtime database fsync and actual transactional/locking checks remain
enabled. No existing cluster is initialized or reset by this change.

Fifth focused attempt: INCOMPLETE, stopped before assertions after CSS also
stalled under Node 24.20.0 (Next ready 18.8s, then root compilation stalled).
Owned app/database cleanup passed. Complete output saved as
reports/step3-preflight-fifth-run-incomplete.txt. Fixture launchers now select
the [supported Next Webpack mode](https://nextjs.org/docs/app/api-reference/cli/next)
for deterministic API/browser verification; package pins and default production
build command unchanged. Sixth focused run active. This is infrastructure
recovery, with no skipped assertions or production verifier change.

Sixth focused attempt: FAILED (3 pass, 1 fail), not an incomplete no-test run.
Webhook signature/stale/future/raw-body assertions passed (both required 401s).
The worker HTTP acceptance timed out at its unchanged 30s while Next first
compiled `/api/internal/process-email-jobs`; full output retained in
reports/step3-preflight-sixth-run-failed.txt. Owned app/database cleanup passed.
Setup now warms that worker route using missing credentials and requires 401,
which claims no jobs and sends no mail. The test is neither skipped nor retried
inside its assertion. Seventh focused run active; current date 2026-10-03 WAT.

Seventh focused preflight PASSED: 4 pass, 0 fail, 23 expectations; 47.45s test
execution. Runner exit 0 and owned app/database cleanup passed. Complete output
reports/step3-webhook-preflight-win32-output.txt. Earlier tracked Phase 4 focused
log restored from main; all Step 3 failures/incomplete attempts retained separately.
This validates the +/-360s fixture margin with the production five-minute
verifier and original acceptance assertions unchanged.

First full local run FAILED: 149 pass, 11 fail, 1 unhandled error; 160 cases,
729.81s. The 112-case Phase3b group passed. Existing Phase4 PDF/refund/resend
cases timed out; one refund transaction expired at 12,273ms against unchanged
10,000ms. Python PDF inspection was killed after the unchanged 60s test timeout,
producing the between-test error. Two new status cases timed out at 30s; the
other 13 new cases passed, including calendar/content/contact and approved PDF/
void/refund behavior. Failing-kick second app was correctly NOT run after failure.
Complete output reports/step3-first-full-run-failed.txt. Owned cleanup passed.
No local full-regression pass claimed. Investigating setup/runtime pressure;
assertion, transaction and production verifier timeouts remain unchanged.

Local lint PASSED (exit0), complete UTF-8 output reports/step3-lint-output.txt.
Typecheck then FAILED at application stage: Webpack generated route validators
rejected two pre-existing unused named exports (`clientIp`, `WEBHOOK_BODY_LIMIT`).
Removed only their `export` keywords after confirming no consumers; helper code,
64 KiB body cap and production signature verifier are unchanged. Tooling stage
was not reached in that combined command. Failure preserved in
reports/step3-typecheck-webpack-exports-failed.txt; both final checks pending.

Runner now restarts only its owned app/test processes between baseline, Phase4
and Step3 groups, preserving one disposable database and all original cases.
Setup preloads Python's actual verifier libraries (`pymupdf`, `zxingcpp`) and
compiles the affected routes. OWNER controller warmups use the freshly seeded
fixture account and invalid bodies (400), with no order transitions or sends.
Missing-token PDF/status warmups require uniform404; customer-page warmup200
carries no token. Failed warmup contracts fail immediately. Production gates,
SQL lock order, runtime database fsync and assertion/transaction limits unchanged.
Only installed Python3.14 is available locally; CI explicitly uses3.13. The next
run must verify the native imports rather than infer a PDF pass from setup.
