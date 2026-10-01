# Imported baseline verification

Current milestone: in progress. Branch: `chore/import-and-verify-baseline`.
Draft [PR #1](https://github.com/tochigit/silent-rave/pull/1) targets `main`.
The import is preserved in `ffdf940`; it was committed with verification pending.

## Changes under verification

- Replaced Linux fixture scripts with a portable isolated database/app runner.
  It supplies fixture environment values, uses separate ports, and never writes
  root `.env` or modifies a configured hosted database.
- Added regressions for the ten-ticket order limit, revival against active
  reservations, and global tier locking across an expiry batch. Fixed those
  service paths and separated email/phone advisory-lock namespaces.
- Enabled production build type checks and separate test/tooling type checks.
- Removed 14 unused imported dependencies, pinned retained direct versions,
  and added a frozen-install CI workflow.

## Evidence so far

- `git diff --check`: passed.
- Windows dependency installation: incomplete. Bun reported missing package
  files; npm recovery also stalled and its owned process was stopped. Treat
  `node_modules` as incomplete; do not trust its installation summary.
- First `bun run test:phase3b`: failed during Prisma generation because `effect`
  was missing. **No test cases ran.** See
  [setup-failure.txt](../reports/setup-failure.txt). Its printed cleanup claim
  was too broad: one database I/O worker and the runner stayed alive. The exact
  owned processes were stopped after inspecting their executable/arguments.
  The runner now tracks its test subprocess, uses synchronous PostgreSQL I/O,
  and explicitly exits after cleanup and output flushing. These changes still
  need verification.
- Full Phase 3b suite, lint, type checks, build, and hosted CI: pending.

## Boundaries and next action

No hosted Supabase project, real email, or production data was used. Supabase
Storage, email delivery, public/owner/staff UI, offline scanning, shared rate
limits and deployed behavior remain later milestones. The historical 109-test
claim remains unverified.

Reconcile dependency installation, run all baseline checks, save their
complete outputs and reconcile CI before marking this milestone complete.
Review and merge require approval of this specific PR. Retain its branch after
merging. Do not start Phase 4 without explicit continuation.
