# Silent Rave checkpoint

## Agreed delivery

Continue one verified milestone at a time: imported baseline, Phase 4,
customer experience, owner/staff operations, then hosted integration.
Stop between milestones; merge only a specifically approved PR. Keep branches
after merging (user instruction). Target: Vercel Free, Namecheap domain
`silentrave.space` (not purchased), Supabase and Resend. About/Contact must be
owner editable and offline staff scanning is required. No fixed deadline supplied.

## Current milestone: Step 1 complete; review and merge approval pending

- Branch: `chore/import-and-verify-baseline`; base: `main`.
- PR: https://github.com/tochigit/silent-rave/pull/1. Nothing merged.
  Inspect live review status, remote head and checks on resume.
- Imported work preserved in `ffdf940`. Verified code: `e30a837`;
  later commits contain final documentation and saved test output.
- Clean npm install succeeded (551 packages); `package-lock.json` is committed.
  Windows installs with npm; Linux CI uses the existing frozen Bun lock.
  Do not install over the usable tree to repeat earlier recovery attempts.
- Fixture: isolated loopback database/app, UTF-8 initialization, Windows pg_ctl
  startup/shutdown, sanitized diagnostics and file-based control output.
- Baseline fixes: whole-order quantity cap, revival versus reservations,
  global sweep tier locking, separate email/phone advisory namespaces.
- Mobile/carousel use external-store subscriptions; both carousel listeners
  unsubscribe. Test helpers avoid redundant clients and prepare the A6 fixtures
  sequentially while all five checkout requests still run concurrently.

## Verification and evidence

- Local Windows: npm install, lint, application/tooling type checks, production
  build, and all 112 tests in 8 files passed; final runner exit 0.
- Windows and Linux CI passed installation, generation, lint, both type checks,
  all 112 tests and build at `e30a837`:
  https://github.com/tochigit/silent-rave/actions/runs/36990540505.
  Final documentation/evidence push triggers a separate CI run; inspect the
  latest PR-head checks before merging.
- Full output: `reports/phase3b-win32-test-output.txt` (local),
  `reports/phase3b-win32-ci-test-output.txt` and
  `reports/phase3b-linux-test-output.txt` (CI). Historical reports remain separate.
  See `.docs/BASELINE_REPORT.md` for exact origins and earlier failures.
- Final local cleanup independently checked: no Bun/Node/PostgreSQL/pg_ctl/initdb
  processes, current fixture removed, root .env remained absent. No task
  processes remain. Earlier stopped diagnostic `.test-runtime/run-5J8iZl`
  and ignored dependency backups/caches are retained.
- Two intermediate local runs had one setup connection failure each (111 pass);
  sequential setup resolves the final run without changing race assertions.
  Failure logs remain ignored. An obsolete launcher CI run was canceled.
- No hosted database, real email or production data was used. Phase 4 has not
  started. Most public/owner/staff UI and Supabase Storage remain stubs.

## Exact next action

1. Inspect current PR #1, remote head and checks. Do not repeat passed baseline
   checks unless code changes or a new failure warrants it.
2. Wait for explicit authorization to merge PR #1. Verify the remote merge,
   update local main without discarding work, and retain both local/remote
   task branches. No merge is authorized yet.
3. Await explicit continuation for Step 2: Phase 4 email worker, ticket PDFs,
   refunds, resend-tickets and Resend webhook. Use a new branch from the merged
   baseline; read current .docs and the attached Phase 4 prompt first.
4. Phase 4 prompt:
   `C:/Users/Tochi/.codex/attachments/31b64bb6-aa09-4993-a36b-e232a6e49fe1/Pasted text.txt`.
   Preserve the current scaffold and specifications; do not restart the project.

## Planning decisions to retain

- Refunds require password re-entry under doc 06; doc 03 omits the field.
- Resend retries need stable payloads and respect 24-hour idempotency retention.
- Vercel needs shared rate limits, durable storage, bounded workers and an
  every-minute scheduler (planned through Supabase Cron).
- Vercel Hobby's commercial restriction was explained; user retained the free
  plan. No paid upgrades authorized.
- Supabase is not created/connected. Hosted setup, DNS, delivery and deployment
  must be verified separately from local and CI checks.
