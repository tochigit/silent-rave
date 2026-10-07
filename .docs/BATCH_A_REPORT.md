# Batch A acceptance: uploads and durable storage

2026-10-07, Africa/Lagos. Batch A implements shared upload bounds, browser retries,
durable HTTP storage, immutable private artifacts and reconcilable accounting.
PR #7: https://github.com/tochigit/silent-rave/pull/7
Branch `feat/step5c-upload-storage`; merged-main base `0da2051ca9c617fbe09d50cabcd2e2232045fd9f`.
No merge or Batch B is included. Operational contract: [doc 10](10-uploads-durable-storage.md).

## Verified implementation

Head `9f4f7fe4d61e7da4069a5038e26fa0778ca0e13b` passed complete Windows/Linux
[CI 37645797361](https://github.com/tochigit/silent-rave/actions/runs/37645797361).
Evidence: `reports/step5a-ci-37645797361/{linux,win32}/`. Final publication checks
must target the published PR head; their exact head/run are recorded in the PR and
Desktop Batch A continuation. Do not infer a later head's status from this run.

Each OS passed **196 regressions**: the existing 183 plus 13 upload/storage cases.
The full suite explicitly skips the separate browser case. A dedicated Linux run
then passed that case under supported Node 24/owned Chrome, using a new loopback
database, app and fake provider. It verified actual canvas preparation, unsupported
HEIC without a POST, non-JSON 413 feedback, retained fields/prepared bytes/submission
ID, exactly one proof attempt, successful banner retry, mobile width and no page
JavaScript errors. Saved receipt/banner screenshots were visually inspected.
Browser client 1.58.2 is installed only under ignored `.test-runtime`; dependency
locks and application dependencies are unchanged.

Both OSs also passed lint, both TypeScript configurations, seven readiness cases,
eight runtime-policy cases, route guard audit, scanner generation, offline Netlify
build, generated Edge ordering/context and isolated final Node ZIP acceptance.
Packaged native Prisma, Sharp sanitation, application-signed proof reads, ledger
linking, role/token changes during I/O, PDF/font/license/diacritics/Lagos-time/exact
stored QR decode and canary/dotenv privacy scans passed. Platform/cache/provider
context was synthetic; this is not hosted Netlify or Supabase execution.

Disposable replay passed original migration fingerprints and forward-only backfill:
three old proof/PDF/banner references remained unchanged, unknown metadata stayed
explicit, synthetic public roles were denied, RLS was enabled, fixture owner data
was unchanged and repeat deployment was a no-op. The four historical migration
files are unchanged; only the new storage-accounting migration was added.

## Local and historical results

Local supported Node24 generation, both types, direct Bun ESLint, seven readiness
cases, route guard audit and disposable backfill/role-denial/repeat-deploy passed.
The subsequent focused app startup timed out before executing tests; its saved
`reports/step5a-local-win32-readiness-incomplete.txt` is incomplete, never a pass.
Owned app/database cleanup passed; owned process count was zero and root dotenv
absent. The initial stalled Bun generation is also incomplete. Global Node26 and
all previous branches/interrupted fixtures were preserved.

Earlier CI failures remain historical: wrong test DTO, missing fixture hold expiry,
old synthetic noncanonical proof path, concurrent ORM intent creation and Bun/CDP
connection timeout. Fixes kept the existing DTO/hold/privacy contracts, used atomic
SQL intent creation and moved browser automation into supported Node. Fake providers
check no-overwrite after reading request bodies so concurrency cannot bypass it.
Run 37548057323 passed before the dedicated browser stage; run 37645797361 verifies
the final implementation and browser. No failed/skipped check is called a pass.

## Review and launch boundaries

Stop for review after exact-head publication checks. Do not merge or start Batch B
without a later explicit instruction. No hosted database/configuration/bucket,
object import/deletion, DNS/deployment/purchase, real email/push or permanent owner
change occurred. `readyForLaunch=false` remains intentional. Existing paths/objects
need approved reconciliation before remote activation; unsupported paths get a
private fixed error and dry-run diagnostics, with their references preserved.
Hosted durability/anonymous denial/backups and physical HEIC/camera/device evidence
remain later launch gates. Database backups do not include object bytes.
