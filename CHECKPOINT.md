# Silent Rave checkpoint

## Agreed delivery

Continue the imported project one verified milestone at a time: baseline,
Phase 4, customer experience, owner/staff operations, then hosted integration.
Stop after each milestone for review. Merge only a specifically approved PR.
Keep branches after merging (user instruction). Hosting target: Vercel Free,
Namecheap domain `silentrave.space` (not yet purchased), Supabase, and Resend.
About and Contact must be owner editable. No fixed delivery date was supplied.

## Current milestone: Linux baseline verified; Windows verification incomplete

- Branch: `chore/import-and-verify-baseline`; base: `main`.
- Draft PR: https://github.com/tochigit/silent-rave/pull/1.
- Import and verification checkpoint pushed: `ffdf940`, `cb96b84`.
- Remote currently contains only the original specification (initial commit
  `f1e732f`). Preserve the imported application and v2.1.2 docs here.
- Linux CI passed all 112 tests (109 imported + 3 new regressions), lint,
  application/tooling type checks and production build at `443bf0c`.
  Run: https://github.com/tochigit/silent-rave/actions/runs/36935985053.
  Complete test output: `reports/phase3b-test-output.txt`.
- Replaced imported Linux-only fixture scripts, which overwrote root `.env`
  and stopped shared-port listeners, with isolated portable tooling.
- Supabase Storage is a documented stub. Public/owner/staff pages are mostly
  placeholders. These belong to later milestones, not this baseline.
- Audit locking and revival inventory; enable type checking in production
  builds and resolve baseline failures.

## Checks and next action

- Initial scan found no credential-pattern matches in the imported text files.
- Remote `main` was verified read-only; no other remote branches were listed.
- Import preserved in pushed commit `ffdf940` (verification explicitly pending).
- Bun installs left missing package files on Windows, including a clean-copy
  retry. npm recovery stalled and its owned process was stopped after checking
  its command line. Treat `node_modules` as incomplete. Do not run another
  install over this tree without inspecting it. An earlier tree is preserved
  in ignored `.test-runtime/dependency-backup`.
- Removed 14 unused sandbox dependencies after checking source imports; pinned
  retained direct dependencies to their imported `bun.lock` versions.
- Portable fixture/runner implementation and CI workflow are written but
  unverified. New regression tests cover order-wide quantity limits, revival
  versus active reservations, and global sweep tier lock ordering.
- Application fixes for all three regressions and separate email/phone
  advisory-lock namespaces are covered by the passing Linux suite.
- First isolated runner attempt failed at Prisma generation: missing `effect`
  package. No test cases ran. Its cleanup left a PostgreSQL I/O worker and a
  Bun process; those exact owned processes were stopped after verification.
  Runner now tracks its test child and uses synchronous PostgreSQL I/O.
- Linux CI also passed frozen dependency install and Prisma generation.
  Earlier typing failures were resolved by `4c11d97` and `443bf0c`.
- Final local process check found no Node, Bun or PostgreSQL processes. No
  dependency install, local server or database is left running.
- Exact next action: inspect PR #1/current Git/process state, then reconcile
  the Windows dependency tree. Inspect missing package files before reinstalling;
  try a clean install with a fresh task-local Bun cache rather than repeatedly
  installing over this tree. Verify recursive move/delete targets stay inside
  this workspace. Preserve the imported code and existing branch.
- After a usable install, run `bun --no-env-file run test:phase3b`, lint,
  type checks and build with loopback configuration. Save local output separately
  from committed Linux evidence and verify owned process/fixture cleanup.
  Keep PR #1 draft until this local gap is resolved; do not start Phase 4.
- No Supabase project, real email, or production data is involved.

## Planning corrections to retain

- Refunds require password re-entry under doc 06; doc 03 omits that field.
- Resend retries must respect its 24-hour idempotency retention and stable
  request payload requirement.
- Vercel deployments need shared rate limits, durable object storage, bounded
  workers, and an every-minute scheduler (planned through Supabase Cron).
- Vercel Hobby's personal/non-commercial restriction is documented; user
  explicitly retained the free plan as the intended host. No paid upgrades
  are authorized.
