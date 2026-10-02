# Silent Rave

Next.js and Prisma/PostgreSQL campus event ticketing with manual bank-transfer
review. The imported Phase 3b backend passes local Windows and Windows/Linux
CI verification; the customer site, full dashboards, offline scanner, email
worker and production integrations are
later milestones. See [CHECKPOINT.md](CHECKPOINT.md) for current status.

## Local verification

Use Bun 1.3.14 to run the tests. On Windows install dependencies with
`npm ci --ignore-scripts --no-audit --no-fund` using `package-lock.json`.
Linux CI uses `bun install --frozen-lockfile` with `bun.lock`. Both paths
are checked by CI. Then run:

```sh
bun --no-env-file run test:phase3b
bun run lint
bun run typecheck
bun run build
```

The test command creates a new embedded PostgreSQL cluster, applies migrations,
seeds fake owner/catalog data, starts an app on its own loopback port, runs all
Phase 3b files, and stops only its own processes. Complete test output is saved
to `reports/phase3b-<platform>-test-output.txt` (`win32` on Windows, `linux` in
Linux CI). This keeps local evidence separate from the previous Linux report
at `reports/phase3b-test-output.txt`. Debug app output is in the ignored
`reports/phase3b-server.log`.

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

For the real application, copy `.env.example` into a gitignored `.env`, provide
the intended database/secrets, and use `bun run dev`. Use `db:deploy` for reviewed
forward migrations; do not use `db:push` or `db:reset` on hosted databases.

## Specification and delivery

`.docs/CHANGELOG.md` and `.docs` v2.1.2 are the active specification. Ignore
`.docs/archive` when implementing. Prototype files in `references` inform the
visual work only; their client-side payment/ticket logic is not authoritative.

Deliver one verified milestone and PR at a time. Merge only after approval for
that PR, and retain branches after merging, as requested by the user.
