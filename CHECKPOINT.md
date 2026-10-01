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
- Remote currently contains only the original specification (initial commit
  `f1e732f`). Preserve the imported application and v2.1.2 docs here.
- Existing Phase 3b tests have not been run in this workspace. The prior
  prompt's 109-test claim is unverified; report the actual runner count.
- Existing fixture scripts assume Linux, overwrite root `.env`, and stop
  listeners on shared ports. Replace them with isolated portable tooling.
- Supabase Storage is a documented stub. Public/owner/staff pages are mostly
  placeholders. These belong to later milestones, not this baseline.
- Audit locking and revival inventory; enable type checking in production
  builds and resolve baseline failures.

## Checks and next action

- Initial scan found no credential-pattern matches in the imported text files.
- Remote `main` was verified read-only; no other remote branches were listed.
- Dependencies are being installed from the imported lockfile.
- Next: preserve the import, implement portable fixture/test commands, run all
  Phase 3b files, lint, type checks, and production build; save complete output.
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
