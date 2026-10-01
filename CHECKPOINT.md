# Silent Rave checkpoint

## Agreed delivery

Continue the imported project one verified milestone at a time: baseline,
Phase 4, customer experience, owner/staff operations, then hosted integration.
Stop after each milestone for review. Merge only a specifically approved PR.
Keep branches after merging (user instruction). Hosting target: Vercel Free,
Namecheap domain `silentrave.space` (not yet purchased), Supabase, and Resend.
About and Contact must be owner editable. No fixed delivery date was supplied.

## Current milestone: imported baseline verification — in progress

- Branch: `chore/import-and-verify-baseline`; base: `main`.
- Draft PR: https://github.com/tochigit/silent-rave/pull/1.
- Import and verification checkpoint pushed: `ffdf940`, `cb96b84`.
- Remote currently contains only the original specification (initial commit
  `f1e732f`). Preserve the imported application and v2.1.2 docs here.
- Existing Phase 3b tests have not been run in this workspace. The prior
  prompt's 109-test claim is unverified; report the actual runner count.
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
- Application fixes are written for all three regressions, plus separate
  email/phone advisory-lock namespaces. They have NOT been tested yet.
- First isolated runner attempt failed at Prisma generation: missing `effect`
  package. No test cases ran. Its cleanup left a PostgreSQL I/O worker and a
  Bun process; those exact owned processes were stopped after verification.
  Runner now tracks its test child and uses synchronous PostgreSQL I/O.
- Lint, type checks, build and full Phase 3b results remain unverified.
- Next: inspect draft PR #1/CI status; reconcile dependency
  installation, then run all Phase 3b files, lint, type checks and production
  build. Save complete output. See `.docs/BASELINE_REPORT.md` for exact status.
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
