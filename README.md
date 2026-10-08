# Silent Rave

Next.js and Prisma/PostgreSQL campus event ticketing with manual bank-transfer
review. The backend includes queued email delivery, ticket PDFs, owner refunds
and resends. Step 3 adds the public catalog, guest checkout, receipt upload,
private order status/recovery, calendars and content/contact pages. Step 4 adds
owner operations, invite-only staff and an online scanner with required offline
preparation, signature verification and durable sync. Hosted integration and
deployment remain Step 5. See
 [.docs/11-shared-controls-release.md](.docs/11-shared-controls-release.md) for
 shared limits, quota deferral, restricted database access and the current release
 gates. `bun --no-env-file run test:step5b` runs the complete regression with each
 app group using a restricted login and a fresh owned database; fixture setup
 uses a separate operator connection. Hosted operation remains unverified. See
[CHECKPOINT.md](CHECKPOINT.md) and [.docs/STEP4_REPORT.md](.docs/STEP4_REPORT.md)
for verification and review status; [.docs/PHASE4_REPORT.md](.docs/PHASE4_REPORT.md)
preserves the completed backend evidence and launch checklist.

## Local verification

Use Bun 1.3.14 to run the tests. On Windows install dependencies with
`npm ci --ignore-scripts --no-audit --no-fund` using `package-lock.json`.
Linux CI uses `bun install --frozen-lockfile` with `bun.lock`. Both paths
are checked by CI. Then run:

```sh
bun --no-env-file run test:step4
 bun --no-env-file run test:step5b-controls
 bun --no-env-file run test:step5b
bun run lint
bun run typecheck
bun run build
```

The test command creates owned embedded PostgreSQL clusters, applies migrations,
seeds fake owner/catalog data, starts an app on its own loopback port, runs all
Phase 3b, Phase 4, Step 3 and Step 4 files, then HTTP tests with failing email kicks, and stops
only its own processes. Install Python 3.13 and the PDF verification dependencies
with `python -m pip install -r scripts/requirements-pdf-test.txt` first. Complete
output is saved to `reports/step4-<platform>-test-output.txt`; downloaded CI
evidence is saved to `reports/step4-ci-*-<platform>-test-output.txt`. Customer and
operations groups each receive a fresh owned database. The customer
group starts from a fresh database after the backend fixture is cleaned up,
because legacy tests deliberately alter counters/order states. The baseline-only command
`bun --no-env-file run test:phase3b` and backend `test:phase4` remain available.
Node 24 LTS must be on PATH for Next's CSS workers; Bun runs the guarded fixture/tests
with dotenv disabled and Next receives their explicit local environment.
Fixture launchers use supported Next Webpack mode after local Turbopack CSS
worker stalls; default production build remains separately verified.
Debug app output is ignored.

Test data and private files live in a unique directory under `.test-runtime/`.
Cleanup verifies that path before removing it. The command never writes root
`.env` or connects to a configured hosted database. It refuses production and
non-loopback database URLs before creating a fixture. Direct `bun test` calls
are intentionally rejected; use the runner.

For an interactive app with fake fixture data:

```sh
bun --no-env-file run db:fixture
```

This starts a fresh temporary database and a dev app on port 3000; keep the
command running. It uses strict Origin checks: public `localhost:3000`, owner
`admin.localhost:3000`, staff `staff.localhost:3000`. The fixture account is
`owner@silentrave.ng` / `silentrave-dev-owner` (local test data only). The fixture
is removed when the command stops; it never seeds a real project.

The focused browser fallback is `bun --no-env-file run db:fixture --browser-step4`
(the Step 3 browser command remains available).
It uses installed Chrome and `playwright-core` from ignored
`.test-runtime/browser-check/node_modules` (install only there with
`npm install --prefix .test-runtime/browser-check --no-audit --no-fund playwright-core@1.58.2`).
The fixture bundles the check into an ignored temporary Node script with Bun,
then runs it under Node 24 with an owned Chrome profile and loopback CDP port.
`BROWSER_EXECUTABLE` can select another installed Chromium. No dependency locks
are changed for browser QA. Complete Step 4 output/screenshots are under `reports/step4-*`.
Only public cart selection and optional holder names use tab-scoped sessionStorage;
tokens, checkout email/phone and receipt files are never stored there. Order links
are bearer credentials; save the private link and do not share it.

The new reviewed forward migration adds About/Contact content plus checkout bank
snapshots. Existing orders are backfilled from their referenced account as it
exists at migration time; past edits cannot be reconstructed. Fresh checkouts
record exact bank instructions. Missing snapshots never use a different active
bank. Step 4 provides the owner content editor; production has no fake content seed.

Read [.docs/07-owner-and-scanner-operations.md](.docs/07-owner-and-scanner-operations.md)
before operating the door. Connected scanners share atomic server admission.
During an outage use **one offline scanner for the whole event**. Refunds,
cancellations and other devices' scans can be stale until sync; multiple offline
devices cannot prevent double entry. Never discard pending scan evidence.

For the real application, copy `.env.example` into a gitignored `.env`, provide
the intended database/secrets, and use `bun run dev`. Use `db:deploy` for reviewed
forward migrations; do not use `db:push` or `db:reset` on hosted databases.

For local email verification, use `EMAIL_TRANSPORT=capture`, valid sender/reply
addresses, `PUBLIC_BASE_URL`, and a random 32-byte base64url
`EMAIL_PAYLOAD_SECRET` (see `.env.example`). `bun run email:dev` runs
the capture worker loop outside production. Capture writes private files and
never sends email. The fixture supplies these values automatically.

Production uses the direct Resend HTTPS transport. Configure its API and webhook
secrets and schedule an authenticated POST to `/api/internal/process-email-jobs`
every minute with `x-cron-secret`. Keep the payload encryption key stable while
jobs remain queued. Inspect FAILED jobs, and reconcile `DELIVERY_UNCERTAIN` with
the provider before issuing a fresh resend. Supabase storage is still a stub;
real delivery, scheduler, storage and deployment checks remain unverified.

## Specification and delivery

`.docs/CHANGELOG.md` and `.docs` v2.1.2 are the active specification. Ignore
`.docs/archive` when implementing. Prototype files in `references` inform the
visual work only; their client-side payment/ticket logic is not authoritative.

Deliver one verified milestone and PR at a time. Merge only after approval for
that PR, and retain branches after merging, as requested by the user.
