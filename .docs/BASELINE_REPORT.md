# Imported baseline verification

Step 1 is complete. The imported backend has a reproducible isolated test
fixture and passes local Windows checks and Windows/Linux CI.
[PR #1](https://github.com/tochigit/silent-rave/pull/1) targets `main` on
`chore/import-and-verify-baseline`; approval to merge is still pending.
The import is preserved in `ffdf940`. Verified application/tooling code:
`e30a837930e63b4a2fad6e80849ab32e94680e79`.

## Changes

- Replaced destructive Linux fixture scripts with an isolated database/app
  runner. Each run uses its own loopback ports and directory, supplies fake
  configuration, and leaves root `.env` and hosted databases untouched.
- Added UTF-8 PostgreSQL initialization and Windows pg_ctl startup/shutdown.
  File-based control output avoids daemon-inherited pipe handles; startup
  diagnostics redact the temporary database password. Cleanup removes only
  the owned fixture after stopping its app and database.
- Fixed the ten-ticket limit across the whole order, revival against active
  reservations, and globally ordered tier locking across an expiry batch.
  Email and phone advisory locks now use separate namespaces.
- Added three regression cases without weakening the imported assertions.
  Concurrent checkout still sends five requests in parallel; fixture setup
  and state reads are sequential to avoid Windows setup connection failures.
  The initialize helper skips unnecessary clients and disconnects in finally.
- Enabled production build type checks and separate application/tooling checks.
  Replaced mobile/carousel effect-driven state with external-store subscriptions;
  both carousel event listeners are removed on unsubscribe.
- Removed 14 unused imported dependencies and pinned retained direct versions.
  Windows uses the committed npm lock; Linux uses the existing Bun lock.
  CI verifies both installation paths and full suites.

## Verification on 2026-10-02

[CI run 36990540505](https://github.com/tochigit/silent-rave/actions/runs/36990540505)
passed on both operating systems at the verified code commit.

| Check | Local Windows | Windows CI | Linux CI |
|---|---|---|---|
| Dependency installation | Clean npm install passed | npm ci passed | Frozen Bun install passed |
| Prisma generation/migration | Passed in isolated fixture | Passed in isolated fixture | Passed in isolated fixture |
| ESLint | Passed | Passed | Passed |
| Application and tooling TypeScript | Passed | Passed | Passed |
| All Phase 3b tests | 112 pass, 0 fail, 8 files | 112 pass, 0 fail, 8 files | 112 pass, 0 fail, 8 files |
| Production build | Passed | Passed | Passed |
| Runner cleanup | Exit 0; independently checked | Exit 0; cleanup logged | Exit 0; cleanup logged |

Complete final test output (trailing whitespace normalized):

- [Local Windows](../reports/phase3b-win32-test-output.txt): 83.59 seconds of tests.
- [Windows CI](../reports/phase3b-win32-ci-test-output.txt): 41.88 seconds of tests.
- [Linux CI](../reports/phase3b-linux-test-output.txt): 34.59 seconds of tests.

The count is 109 imported cases plus three regressions. No pre-fix execution of
the new regressions was captured. Earlier installation, encoding, and launcher
failures were resolved; two subsequent local runs had 111 passes and one A6
setup connection failure, before checkout HTTP began. The final setup change
passes locally and in both CI jobs. These failed local outputs remain in ignored
`reports/*.log`; [setup-failure.txt](../reports/setup-failure.txt) and
[phase3b-test-output.txt](../reports/phase3b-test-output.txt) are historical
evidence, not final local results.

Local lint/build passed before the final test-helper-only change; application
and tooling type checks were repeated afterward. CI verifies every check with
the final helper code. Local Node 26.5.0, npm 11.17.0, Bun 1.3.14 were used.
Local shutdown was independently checked: no Bun, Node, PostgreSQL, pg_ctl or
initdb processes remained, the final run directory was removed, and root
`.env` remained absent. The earlier stopped diagnostic fixture
`.test-runtime/run-5J8iZl` and dependency backups are retained, ignored.

## Boundaries and next action

This verifies the imported backend baseline, not production readiness. No
hosted Supabase project, real email, or production data was used. Browser
visual behavior, Supabase Storage, customer/owner/staff screens, offline scanning,
shared production rate limits, and deployed behavior remain unverified or
unimplemented. Phase 4 has not started.

Review and merge PR #1 only after explicit approval. Retain the branch after
merging. Await explicit continuation before Step 2: Phase 4 email worker,
ticket PDFs, refunds, resend-tickets and Resend webhook.
