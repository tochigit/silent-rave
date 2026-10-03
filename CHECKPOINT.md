# Silent Rave checkpoint

Updated 2026-10-03, Africa/Lagos. Specifications: .docs v2.1.2.

1. Baseline: COMPLETE; PR #1 merged at 982eb9f.
2. Email/PDF/refund backend: COMPLETE; PR #2 merged at 7fcf42d8fb13e5f77ce6f8db8fe613987e591670, live API verified.
3. Customer experience: COMPLETE; PR #3 merged at 8984f9eccff51ff96088155e47e9afeef0c4d633 after current exact-head checks passed.
4. Owner/staff and REQUIRED offline scanner: IN PROGRESS on feat/step4-owner-staff-scanner from current main 8984f9e. User authorized merge and continuation on 2026-10-03. See .docs/STEP4_REPORT.md.
5. Hosted integration/deployment: NOT STARTED.

Step 4 is now authorized. All original branches and settled guest/manual-transfer/OWNER-approval/platform decisions are retained. No Step 5 or deployment. Step 3 validation below describes its completed baseline; Step 4 validation is pending.

## Verified results

- Webhook preflight: 4 pass/0 fail/23 expectations; runner exit0 and cleanup. Fixture timestamp margin +/-360s; production five-minute raw-body verifier unchanged.
- Third full LOCAL regression: 162 pass/0 fail across 21 files (112 baseline +33 Phase4 +15 Step 3 +2 failing-kick cases), runner exit0. All 147 original cases/assertions preserved. Both owned clusters and app processes stopped; temporary fixtures removed; no PostgreSQL process remained.
- Actual Chrome browser: 37 checks passed; entire guarded fixture command exit0. Mobile guest checkout/payment refresh/upload retry/idempotency/no tickets/owner reject/resubmit/approve/PDF before email/refund, expiry/late proofs/privacy/recovery/contact, hidden/resume/backoff/terminal polling, desktop/landscape/large-text/reduced-motion/overflow. Public screenshots inspected. Owned Chrome/app/database stopped/removed.
- Default production Turbopack build PASSED, exit0.
- Final lint PASSED with direct Bun ESLint and unchanged rules/config/files. Standard final invocation stalled, was explicitly stopped and retained as INCOMPLETE; its combined command never reached types. Initial standard lint and CI lint passed independently.
- BOTH final post-build app/tooling types PASSED, exit0.
- Windows/Linux implementation CI run 37113017063 at 4cc959f1ff644e19ad592bf802baca4d6ac56a88 PASSED:162 cases each, lint, both types, default build and cleanup. Earlier corrected runs 37101263963/37101859267 also passed. Complete artifacts AND job logs retained.

Full report: .docs/STEP3_REPORT.md. Complete local/CI/browser/build/type/lint/failure evidence: reports/step3-*. Final evidence-only publication commits run the same CI; the PR description records the final review head and check run after publication, avoiding a self-referential report commit hash. Verify current PR head/checks again on any later resume.

## Important implementation and recovery decisions

Forward migration adds opt-in About/Contact content and immutable checkout bank snapshots. Legacy orders can only recover referenced account values at migration time; past edits cannot be reconstructed. Missing snapshots never fall back to another active bank. Owner content editor remains Step 4; hosted migration requires later review.

Public DTO allowlists, Lagos filters/CTA ties/calendars, tab-scoped cart, server-priced guest checkout, receipt retry and private status/recovery/contact are complete. Tokens/email/phone/receipts are not stored in browser storage. OWNER approval remains required for tickets. Checkout lock order, expiry/review/refund invariants, role/Origin/password gates, transaction/test limits and production verifier are unchanged.

First full run failed 149/11/1 error; second failed 159/1; all complete outputs retained. Customer group now receives a fresh owned DB after backend cleanup because legacy Phase4 tests deliberately alter order/counter rows with 60s holds. Third local run and both corrected CI platforms passed. Fixture Next uses Node24/Webpack with explicit env; Bun handles tests with dotenv disabled. Browser fallback bundles under Bun and runs under Node24 against an owned loopback Chrome profile; plugins were unavailable. Playwright is installed only in ignored .test-runtime/browser-check. Production build remains default Turbopack.

## Live gaps and preserved state

Hosted durable storage/Supabase pooler/forward migrations/shared rate limits/Resend/DNS/scheduler/runtime/fonts/origins/domain/real content/deployed smoke remain unverified. Physical Safari/HEIC and external calendar accounts were not verified. No hosted changes, real mail, permanent owner/password edits or deployment. Root .env is absent.

Automatic approval review rejected deletion of stopped owned .test-runtime/run-1jNjwR ('blocked by policy', no further detail). It remains ignored/stopped; historical run-5J8iZl/run-HhIUZP retained. Later successful fixtures removed only their owned processes/data. No unrelated process, branch or historical evidence removed.

## Next authorized action

Complete Step 4, regression/API/browser checks, a durable report and focused PR, then stop for review. Do not merge the Step 4 PR, begin Step 5 or deploy without separate approval. Resume by reading this checkpoint and .docs/STEP4_REPORT.md and inspecting current Git, PR/checks and running processes. Historical passes are not current-state proof.
