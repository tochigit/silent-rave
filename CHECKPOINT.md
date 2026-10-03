# Silent Rave checkpoint

Updated 2026-10-03, Africa/Lagos. Specifications: .docs v2.1.2.

1. Baseline COMPLETE; PR #1 merged at 982eb9f.
2. Email/PDF/refund backend COMPLETE; PR #2 merged at 7fcf42d8fb13e5f77ce6f8db8fe613987e591670.
3. Customer experience COMPLETE; approved PR #3 squash-merged at 8984f9eccff51ff96088155e47e9afeef0c4d633 after exact-head checks.
4. Owner/staff and REQUIRED offline-capable scanner COMPLETE; STOPPED FOR REVIEW. PR #4: https://github.com/tochigit/silent-rave/pull/4.
5. Hosted integration/deployment NOT STARTED.

User authorized PR #3 merge and ONLY Step 4 continuation on 2026-10-03.
Branch feat/step4-owner-staff-scanner starts from current main 8984f9e. Latest
verified application implementation: dd0a3ecec0259e22b36a469d62c674418134b951.
The final evidence publication head and exact-head checks are recorded in PR #4
by its description after publication, avoiding a self-referential report hash.
Verify Git/PR/checks live on every resume. All earlier branches remain.
No Step 4 merge, Step 5 or deployment authorization.

## Verified results

- Full LOCAL regression: 175 pass/0 fail, runner exit0 and owned cleanup: 112 baseline +33 Phase4 +15 customer +13 Step4 +2 failing-kick HTTP cases, before delayed-sync fix.
- Frozen-source focused acceptance after that fix: 14 pass/0 fail, 109 expectations, exit0 and cleanup. All original 162 cases/assertions remain. Final full suite is 176 cases across 24 files.
- Final implementation CI37122520636 at dd0a3ec PASSED Windows AND Linux: 176/0 each, locked installs, lint, both types, scanner assets, default production build and cleanup. Complete artifacts AND job logs: reports/step4-ci-final-implementation-\*.
- Fourth actual Chrome run PASSED all 28 checks; entire fixture command exit0. Owner issue/reject/resubmit/approve/resend/refund/invite/password POST; online scan; real QR-image offline decoding/admission; duplicate rejection; cached offline reload/outbox persistence; blocked logout/stale-tab safeguard; reconnect/repeat sync; attendee search; staff403; desktop/mobile/landscape/reduced-motion/24px root text overflow. No JavaScript errors. Screenshots inspected.
- Final local ESLint PASSED directly under Bun, same files/config/rules, exit0. Standard Windows Node invocation stalled and its owned process tree was stopped; saved as INCOMPLETE. Both CI standard lint checks passed independently.
- Default production Turbopack build PASSED, exit0; dummy loopback database URLs, all27 static pages generated. Both final post-build app/tooling types PASSED, exit0.
- Owned Chrome/app/database/check processes stopped; temporary fixture data removed. No PostgreSQL process remained. Root .env absent/untouched. Old unrelated node processes and historical ignored fixture folders retained.

Full report: .docs/STEP4*REPORT.md. Operating guide:
.docs/07-owner-and-scanner-operations.md. Complete local/CI/browser/build/types/
lint/failure output and screenshots: reports/step4-*. Previous Step 3 report and
evidence remain unchanged in .docs/STEP3*REPORT.md and reports/step3-*.

Verification commands: bun --no-env-file run test:step4; the same runner with
explicit tests/step4/local.test.ts, operations.test.ts and push.test.ts paths;
bun --no-env-file run db:fixture --browser-step4; direct Bun ESLint; both
TypeScript configs; bun --no-env-file run build; post-build both TypeScript configs.
Browser fallback uses ignored playwright-core and installed Chrome under Node24,
an owned profile/CDP port and disposable database. Browser plugin was unavailable.
Fixtures use Node24/Webpack; production retains default Turbopack. No acceptance
assertion, production verifier, transaction timeout or test deadline was relaxed.

## Decisions and preserved invariants

Guest checkout, server pricing, manual bank transfer and OWNER bank confirmation/
approval remain. Refunds move no money and require password/checked-in acknowledgement.
Checkout email namespace1, phone namespace2 and sorted-tier locks, expiry/revival/
counters, original tests and production inclusive five-minute webhook verifier
are unchanged. Step 3's +/-360s test-fixture margin is already merged.

Step 4 adds owner management, CASH/COMP idempotent inventory/tickets/email/audit,
STAFF invites/first password replacement, reconciliation, push capture/dispatch,
Places proxy/manual fallback, online atomic admission and prepared offline PWA.
Only public keys reach phones. Admission manifests exclude buyer/payment data;
generic shell alone is cached and IndexedDB durably stores pending evidence.
Additive20261003000000_step4_staff_password defaults false for existing accounts.
Permanent OWNER/password and prior migrations are unchanged.

Multiple connected scanners share atomic server admission. During an outage use
ONE OFFLINE SCANNER FOR THE WHOLE EVENT. Separate offline phones cannot prevent
cross-gate duplicate entry or learn fresh refunds/cancellations. Sync detects
conflicts; earliest corrected evidence sets effective admission and new conflict
entries preserve the immutable ledger. Prepared scanning expires at event end/day
grace; queued pre-end scans can reconcile afterward within seven days. Logout,
prepare and clear guard current saved state; a stale tab cannot silently erase
another tab's scans. Exported evidence contains private QR tokens. Physical
bearer checks and trusted staff remain necessary.

Next fullstack, intended Vercel Free/Supabase/Resend and silentrave.space are settled.
Hosted storage/pooler/migrations/shared limits/origins/cookies/domain, live Resend/
DNS/webhooks/scheduler, Google Places restrictions/attribution, VAPID push, iOS/PWA/
physical camera/gates/realtime and deployed smoke remain UNVERIFIED Step 5 work.
No hosted SQL/reset, permanent account/password change, real mail/push or deployment.

## Review boundary and next action

Next action: USER REVIEW of PR #4. Its final publication head and check run are
recorded in its description after exact-head verification. Do not merge it,
start Step 5 or deploy without separate explicit approval. On resume read this
checkpoint/full report, inspect current Git/PR/CI
and running processes, and establish the user's authorized next scope first.
Historical results do not replace live state verification.
