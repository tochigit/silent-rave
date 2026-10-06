# Batch A: uploads and durable storage

2026-10-07, Africa/Lagos. Implementation and acceptance are in progress on
`feat/step5c-upload-storage`, based on merged main `0da2051`. Batch A combines
5C.2 and 5C.3 into one PR. Check CHECKPOINT.md for current verification status.

Both proof and banner files are limited to 3 MiB (3,145,728 bytes), with a
3.25 MiB (3,407,872 bytes) multipart envelope. Declared and actual bytes are
bounded before parsing. The reader uses one bounded allocation, a total deadline,
bounded headers/names/text fields and exactly one expected image. Browser preparation
is local, JPEG on white, with at most four quality/resize attempts (2400px proof,
1600px banner); unsupported HEIC asks for an export. No remote converter. Receipt
form fields, prepared file and submission ID survive failed retries. Provider HTML
413s get a readable message. Server sanitation orients and strips EXIF/GPS/XMP,
checks decoded formats/pixels and bounds output. Original `file_sha256` remains
the uploaded-byte hash; accounting records stored-byte size and hash separately.

The Supabase adapter uses raw-byte POST with no upsert and authenticated bounded
GETs. Every operation has a five-second deadline, no redirects/cache or disk fallback.
Only configured server credentials are sent: `apikey` for `sb_secret_...`; legacy
service-role JWT also gets Bearer. Incoming browser credentials are never forwarded.
Keys allow only generated proof JPEGs, ticket input-hash PDFs and banner WebPs.
Proof/banner reads cap at 3 MiB and PDF reads at 1 MiB. Only verified object absence
returns null; authorization/quota/network/type/size failures remain unavailable.

Private files stay behind application routes. Proof URLs are signed by the retained
application secret for 90 seconds and need a live OWNER both before and after I/O.
Buyer PDFs retain status-token/version, approval/refund/void and final rechecks.
No Supabase signed/bearer URL is exposed. Banners retain their database-reference
check and `/api/banners/:name` DTO. Public artwork can include uploaded draft artwork.

Writes never replace proof/banner evidence. UUID collisions retry at most three
allocations. PDF keys include rendered inputs, font and style hashes. The first
stored artifact wins; a conflict requires matching PDF/input/hash metadata. Readers
fetch that winner rather than returning a losing render. Provider failure cannot
regenerate/overwrite a cache. Legitimate input changes create a new immutable key.
Local fixture writes also publish atomically without overwriting. Production refuses
local disk storage.

The additive `20261006000000_step5_storage_accounting` migration introduces
`storage_objects` with deny-by-default RLS and revoked public/provider grants.
Intent precedes storage I/O; stored size/hash follow; linking shares the short
transaction that saves a proof/banner/PDF pointer. Provider I/O never holds an
inventory/admission lock. Rollback/crash leaves reconcilable intent or stored bytes.
Backfill preserves old references as LEGACY_REFERENCED with unknown byte metadata.
The four historical migration files are unchanged. Runtime-role policies belong
to Batch B; this migration does not provision roles/buckets or import object bytes.

OWNER-only `GET /api/admin/storage/report` is a dry-run keyset report, 25 records
per page. `?verify=1` checks at most three objects per page to bound worst-case
provider time; `after=<returned next>` continues. Reports flag unsupported legacy
paths, incomplete/failed writes, missing/unavailable bytes, metadata/reference
mismatches and replaced artifacts. Unreferenced files get at least a 24h inspection
grace. The report changes no records, never lists provider buckets and never deletes.
Orphan eligibility must be rechecked against references before any future approved
deletion; no retention/deletion/archive policy is authorized here.

Future provider settings: STORAGE_DRIVER=supabase, server-only SUPABASE_URL and
SUPABASE_STORAGE_SERVER_KEY; SR_PRIVATE_BUCKET=sr-private; SR_BANNER_BUCKET=sr-banners;
retain STORAGE_SIGNING_SECRET. Provisioning remains separately approved. Private
bucket has no public read/list/write policies; banners contain deliberate public
artwork, with server-only writes. Existing paths/bytes/metadata require an approved
inventory/import/reconciliation before activation; unsupported legacy keys are
reported rather than rewritten. DB backups do not include object bytes: back up
objects separately and verify recovery. Preview environments receive no production
database/storage credentials or signing keys.

Validation commands: `bun --no-env-file run test:step5a` (controlled loopback/fake
provider, full baseline plus new cases), `db:preflight`, `db:preflight-storage`,
lint/types/readiness/route-policy, actual offline Netlify build and isolated final
Node ZIP acceptance. Focus accepts named tests under tests/step5a. Report exact
passed/failed/incomplete results; CI is not hosted durability or physical HEIC proof.
`readyForLaunch=false` stays intentional. Publish one focused PR, then stop for
review; no merge, Batch B, hosted access/configuration, DNS/deployment or real sends.

Dedicated browser acceptance: `bun --no-env-file scripts/run-browser-step5a.ts`,
using an owned Chrome profile, loopback app/database and fake Storage. Linux CI
installs pinned Playwright Core 1.58.2 only under ignored `.test-runtime/`, then runs
this check with its installed Chrome. Dependency locks/application dependencies stay
unchanged. The full suite's explicit browser skip is reported separately from this
dedicated result. Checks cover actual canvas output, unsupported HEIC, non-JSON 413,
saved fields/prepared receipt/retry ID, successful proof/banner uploads, mobile width
and JavaScript errors. Physical HEIC/camera/device acceptance remains Batch D.

Protocol references verified during implementation:
[Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[maintained Storage client](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts),
[Storage file metadata](https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/lib/types.ts),
[Supabase changelog](https://supabase.com/changelog),
[separate object backups](https://supabase.com/docs/guides/platform/backups).
