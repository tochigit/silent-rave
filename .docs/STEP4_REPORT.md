# Step 4: owner operations, staff and offline-capable scanner

Status: COMPLETE; STOPPED FOR REVIEW. Updated 2026-10-03, Africa/Lagos. PR #4:
https://github.com/tochigit/silent-rave/pull/4, base main, branch
feat/step4-owner-staff-scanner. No Step 4 merge, Step 5 or deployment approval.

## Authorization and baseline

The user authorized merging PR #3 and beginning Step 4 on 2026-10-03.
Live GitHub verification confirmed reviewed head
177be1744f87a43a59d6f0a2a76835cf3048ed40, clean mergeability and passing
Windows/Linux/security checks before a SHA-guarded squash merge. Current main is
8984f9eccff51ff96088155e47e9afeef0c4d633; this branch started there. All earlier
branches, implementation and decisions are preserved. Repository/parent checks
found no AGENTS.md. The entire handoff and active v2.1.2 specs were read.
Step 3's webhook fixture preflight and production five-minute verifier remain
unchanged. Guest checkout, manual transfers and OWNER approval remain settled,
as do Next fullstack, intended Vercel Free/Supabase/Resend and silentrave.space.
Their hosted configuration and verification belong to Step 5.

## Implementation

- OWNER pages/APIs manage events, banners, venues, organizers, tiers,
  About/Contact, staff, bank accounts, payment review, refunds/resends, email
  delivery, reconciliation and audit/check-in review. Forms use Lagos times and
  kobo. Receipt links are short lived; review shows the immutable bank snapshot.
  Existing approval/rejection/revival/refund/resend services and bank-confirmation,
  password and checked-in-refund acknowledgement gates are reused.
- Draft/publish/banner validation, streamed image upload caps/re-encoding, tier
  locks/capacity floors and referenced-delete conflicts protect management.
  Content stays escaped text; contact recipient routing stays server-side.
  CSV neutralizes spreadsheet formulas and totals distinct approved orders.
- CASH uses current server prices; COMP costs zero. Both consume inventory,
  mint stored signed tickets, queue email and audit actor/reason transactionally.
  Idempotent request IDs prevent double issue and changed retries fail.
  Multi-tier capacity failure rolls back everything. No transfer proof is fabricated.
- Invite-only STAFF must replace temporary passwords before protected APIs work.
  Deactivation revokes sessions and preserves attribution. Additive migration
  20261003000000_step4_staff_password defaults its flag false for existing
  accounts and adds scan/audit indexes. Permanent OWNER credentials and prior
  migrations are unchanged.
- Online check-in verifies the signed/stored ticket, locks order then ticket,
  atomically admits once across devices, and rejects refunds/cancellations/voids.
  Namespace 4 scan-ID locks make retries idempotent and reject changed requests.
  Checkout namespace 1 email, namespace 2 phone and sorted-tier order are unchanged.
- Browser verification uses strict pure-JS Ed25519/public keys only. Camera,
  image and manual QR input; admission-only IndexedDB preparation; durable outbox;
  bounded idempotent batch sync; corrected times; overlap 1000 deltas; stale merge
  protection; backoff/manual/resume sync; and local attendee search are implemented.
  Only generic shell/assets enter the service-worker cache. No buyer/financial
  data or signing private key is embedded in the scanner or manifest.
- Offline success follows durable commit; same-phone duplicates fail. Pending
  scans survive reload/network failure and cannot be silently dropped on logout
  or account/event changes. Explicit private export-and-clear exists. Online auth
  denial blocks scanning. Scanning expires at event end/day grace; pre-end evidence
  can reconcile after event end within seven days, with current refunds/cancellation
  still enforced. Corrected times are stored at admission, not recomputed at sync.
- Earliest offline evidence sets effective admission. Ledger stays append-only:
  a new CONFLICT entry identifies displaced attribution/time rather than rewriting
  a historical VALID result. Unlisted signed admissions require confirmation and
  retain their review flag.
- OWNER push registration validates provider endpoints, exposes only public VAPID,
  sends code-only alerts after proof commit and deactivates dead subscriptions.
  Mandatory visible polling every 12 seconds includes backoff/resume. Google Places
  proxies fixed endpoints with server keys, rate limits and manual-address fallback.
- Dark mint/purple UI includes labeled controls, visible focus, keyboard skip
  navigation, mobile layouts and textual result states. Owner staff tools use the
  staff hostname, preserving strict Origin checks. Generic scanner JS/SW/PNG icons
  are generated and ignored; source is tracked. Pinned additions: @noble/ed25519
  3.0.0, @noble/hashes 2.0.1, jsqr 1.4.0, web-push 3.6.7, @types/web-push 3.6.4.
  Existing dependency versions are preserved.

## Verification

Full guarded LOCAL regression: **175 pass / 0 fail**, runner exit0 and owned cleanup
on 9b31d87: 112 baseline +33 Phase4 +15 customer +13 Step4 +2 failing-kick cases.
The operations group finished before the delayed-sync fix. Frozen-source focused
rerun after it: **14 pass / 0 fail**, 109 expectations, exit0 and cleanup. Final
suite is **176 cases across24 files**. All original162 cases/assertions remain.
Commands: bun --no-env-file run test:step4, and that runner with the three explicit
Step4 test file paths. Full outputs: reports/step4-win32-test-output.txt and
step4-focus-win32-test-output.txt.

CI 37120304333 (9b31d87,175), 37121272307 (8feaf6d,176) and 37121461190
(e9c4939,176) passed Windows AND Linux: locked installs, lint, both types, scanner
assets, default production build and cleanup. Complete artifacts AND job logs:
reports/step4-ci-{corrected,recovery,ui}-\*. Final publication head/checks are
recorded in the PR after evidence commit, avoiding a self-referential hash.
Historical passes require current-head verification on resume.

Browser plugin setup/discovery returned no browser; established owned Chrome
fallback ran under Node24 with ignored playwright-core, its own profile/CDP
port and disposable database. No user browser/session was attached. Fourth
browser run PASSED all 28 checks and the full fixture command exited0. Actual
UI issue/reject/resubmit/approve/resend/refund/invite/password POST, online scan,
offline QR-image decoding and durable admission, duplicate rejection, offline
reload, blocked logout, stale second-tab protection, reconnect/repeat sync,
attendee search, role denial, desktop1440/mobile375/landscape/reduced-motion/
24px root text overflow and no JavaScript errors were verified. Owned Chrome,
app and database stopped and disposable directory was removed. No PostgreSQL
process remained afterward. Complete output is reports/step4-browser-output.txt
and step4-browser-fixture-output.txt. Desktop owner, mobile owner and mobile
scanner screenshots were inspected. Final local direct Bun ESLint PASSED with
identical files/config/rules, exit0. Standard Node invocation stalled, was stopped
and retained as INCOMPLETE. Both app/tooling types PASSED before production build,
exit0. Default Turbopack production build PASSED, exit0 (109s compilation, all
27 static pages generated). It used dummy loopback DATABASE_URL/DIRECT_URL,
no hosted connection. Full output: reports/step4-build-output.txt. Final
post-build app/tooling type confirmation also PASSED, both exit0. Complete output
is reports/step4-post-build-{app,tooling}-types-output.txt. No owned check/app/
browser/database processes remain; earlier unrelated node processes were retained.

Final implementation CI37122520636 at dd0a3ec passed BOTH platforms, all176 cases,
lint, both types, scanner assets, production build and cleanup. Complete artifacts
AND job logs are reports/step4-ci-final-implementation-\*.

## Failed attempts and recovery

1. Bun install reported lifecycle ENOENT and left packages incomplete. Locked npm
   ci restored621 packages, exit0 (27 minutes locally). Initial syntax/types failed
   and were fixed; both checks then passed. Initial type outputs are retained.
2. First focused run:5 pass/6 fail. Existing dynamic order-detail route intercepted
   issuance with405; dedicated static route fixed it. Initial CI37119578104 failed
   issuance/dependent cases on both platforms. Full artifacts/job/local/server
   outputs remain.
3. Second focused run:12 pass/1 fail. Referenced venue FK prevented deletion, but
   Prisma's unknown connector error returned500 instead of409. Explicit reference
   checks/safe conflict classification fixed it. CI37119900660 failed the same
   acceptance; full evidence remains.
4. Review found pre-end offline evidence incorrectly voided after event end.
   Corrected-time evaluation and a regression for pre-end sync/post-end refusal/
   online ended-event refusal fixed it. Third focused run passed that new case
   but failed an existing manifest/refund case with a non-JSON response (13/1).
   UI edits were being published during that dev run; the HTTP status was not
   captured, so cause is unconfirmed. Safe HTTP/path diagnostics were added.
   Frozen-source rerun passed all14. Complete third failed output/server log remain.
   No assertion, verifier, transaction timeout or test deadline was relaxed.
5. First Chrome attempt passed login then failed an exact select-label locator;
   scoped prefix locators fixed it. Second passed owner issuance, financial
   decisions, mobile/desktop and invitation, then stalled after password submit.
   The screenshot showed the password page with empty fields. Native submission
   before hydration was a suspected cause; the form now uses explicit POST and
   disables submit until hydration. Login also has an explicit POST fallback.
   Browser acceptance now verifies the actual password POST response.
6. Scanner review found stale-tab preparation/logout could erase another tab's
   outbox. Preparation and clear now guard current IDB state inside transactions;
   export/logout re-read saved state, and logout retains evidence added during
   its network request. Browser adds a stale second-tab logout case. Initial
   hydration effect failed Windows CI lint37122414789; unchanged rules were
   satisfied with useSyncExternalStore hydration snapshots instead. Linux passed;
   full available artifact/job logs are saved as step4-ci-hydration-failed-\*.
7. Third Chrome attempt failed issuance with a real 11,664ms transaction against
   the unchanged10,000ms limit. No pass is claimed. Full output/screenshot remain.
   Fourth warms issuance/password controllers with invalid400 bodies before UI
   acceptance; these warmups cannot issue, mutate passwords or send mail.
8. Final standard Windows lint stalled without a result; stopped only the verified
   owned PID1204 process tree. Full output is step4-lint-standard-incomplete-output.txt
   and is INCOMPLETE, not a pass. Direct Bun ESLint completed with no output/exit0
   in about five minutes, same configuration/rules/files. Pass metadata is saved
   in step4-lint-output.txt; CI standard lint passed independently on both platforms.

Fixtures force email/push capture and blank provider credentials, use only owned
loopback databases, apply all four migrations, and isolate customer/operations
in fresh databases. Next fixture uses Node24/Webpack; production uses default
Turbopack. Root .env is absent/untouched. Earlier ignored stopped fixture folders
and unrelated processes are preserved.

## Operating limits and review boundary

**During an outage use one offline scanner for the whole event.** Multiple connected
scanners share atomic server admission. Multiple offline devices cannot prevent
cross-gate double entry; sync detects conflicts afterward. Refunds, cancellations,
new approvals and other devices' admissions can be stale until sync. Manifest
age/pending count and warnings remain visible. Physical bearer checks/trusted
staff still matter. Pending exports contain ticket tokens: keep them private.
Full guide: .docs/07-owner-and-scanner-operations.md.

Hosted migrations/pooler/locks, durable public-banner/private-proof storage, shared
rate limits, origins/cookie/domain configuration, Resend/DNS/webhooks, scheduling,
Google Places credentials/restrictions/attribution, VAPID push, physical camera,
Safari/iOS installation/permissions, multiple physical gates, hosted realtime and
deployed smoke remain unverified. Local capture/CI prove no real provider delivery.
No hosted SQL/reset, real mail/push, permanent account/password edits or deployment.
Supabase realtime transport remains Step5; mandatory polling is implemented here.

PR #4 contains only Step 4 and its evidence/checkpoint. Final publication CI and
security checks are verified on its exact head and recorded in the PR description
after this evidence commit; inspect them live on resume. Earlier source commits
and every previous branch are preserved. Step 3 report/evidence remain historical
and unchanged. Full failed outputs are retained alongside final passes.
Text evidence was converted to UTF-8 and trailing line whitespace normalized for
a clean Git diff. No substantive output or assertions were removed. Downloaded
original CI archives and local evidence backups remain ignored locally. Generated
scanner assets and private fixture data are excluded from publication.

STOP FOR REVIEW. Do not merge PR #4, begin Step 5 or deploy without separate
explicit approval. Next action is user review of PR #4; if continuation is later
authorized, re-read CHECKPOINT.md/report and verify Git/PR/checks first.
