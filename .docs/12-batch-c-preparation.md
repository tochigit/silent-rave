# Batch C preparation: target and action review

Prepared 2026-10-08, Africa/Lagos. Authorized scope is **5D.1 preparation only**,
including the mail-quota observer follow-up. This package is ready to review;
resource identities and hosted acceptance are incomplete. No hosted SQL, data
query, configuration, provisioning, migration, seed, history repair, deployment,
DNS change, scheduler enablement or real delivery has been performed.
`readyForLaunch=false` remains. Batch D and PR merge need separate approval.

Read this with the full Desktop Step 5B Netlify plan, Consolidated continuation
and Batch C continuation. Those plans' 5C work is already merged. Historical
unmerged statements in docs 08-11 and reports are dated evidence, not current
Git state. The original poster, reference files, themes, navigation, preview
packages and all branches remain preserved.

## Verified baseline and test follow-up

Live GitHub and Git agree on main `783893b829597c18d2558f146e4cadbf858f39f3`,
tree `cfe8ec416a0b51c82792b42613f7040f4f670097`. PR #10 is merged.
[Exact-main CI 37753142674](https://github.com/tochigit/silent-rave/actions/runs/37753142674)
passed Windows and Linux after an unchanged-head Linux retry. Attempt 1's
lock-observation failure is preserved; a retry did not repair the test.

`fix/batch-c-lock-observer` changes only test observation and preparation records.
The observer deliberately reads activity before releasing the worker, clears
the statistics snapshot before each poll, and requires its own backend to be
among the worker's blockers. The three-second deadline, blocked-worker,
available quota advisory lock, idempotent reservation, final SENT and exactly
one day/month reservation assertions remain. No worker implementation changes.
PostgreSQL documents transaction-cached activity and the explicit
[snapshot refresh](https://www.postgresql.org/docs/18/monitoring-stats.html#MONITORING-STATS-VIEWS).

Local guarded controls passed **24 tests, zero failures, 210 assertions**, using
new disposable loopback PostgreSQL, restricted runtime clients and mocked
delivery. Cleanup stopped its owned database. See
[output](../reports/batch-c-controls-win32.txt) and
[measurements](../reports/batch-c-measurements-win32.json).
Fresh ten-ticket preparation was 14,520 ms, 253,100 base64 attachment bytes,
one recipient and 10,393,279 database bytes. These are local measurements.
Final branch/PR/CI and local lint status are maintained in CHECKPOINT.md and the
Desktop handoff; this baseline CI is not proof of a later branch head.

## Resource register: verified, candidate and missing

| Resource | Evidence available in preparation | Still required for a named action |
| --- | --- | --- |
| GitHub | `tochigit/silent-rave`, main and merged PR #10 verified live | Review/approval of this follow-up PR; no automatic merge |
| Public hosts | Planned `silentrave.space`, `admin.silentrave.space`, `staff.silentrave.space`; DNS resolver sees root A `162.255.119.89`, NS `dns1.registrar-servers.com` / `dns2.registrar-servers.com`; admin/staff unresolved at inspection | Ownership, existing traffic/data/session use, current DNS zone and registrar access; DNS alone proves none of these |
| Netlify | Root repository has reviewed netlify.toml, pinned adapter 5.16.2 and ingress plugin | Team name/ID, Free or legacy plan, site dashboard URL/ID, `<site>.netlify.app`, region/function memory, current deployments, auto-publish state and shared billing usage |
| Supabase | Local configured `supabase` endpoint has candidate reference `gztouoategejatykacqx`; separate `supabase_lsvafnayemozvowjqymz` targets `lsvafnayemozvowjqymz` | Confirm Silent Rave project URL/reference, organization, region, engine, status, ownership, endpoints and existing-data/history state; neither configured reference is an approved target |
| Storage | Intended `sr-private` (private proofs/PDFs) and `sr-banners` (public artwork), server-only writes | Actual bucket IDs/configuration, legacy objects, policies, retained bytes and import needs |
| Resend | Local MCP endpoint configured; intended sender `tickets@mail.silentrave.space` | Team/account, plan and shared usage, sender-domain ID/status, monitored reply-to and contact recipient; no keys in chat |
| Cloudflare | Reviewed source name `silent-rave-scheduler`, fixed root-host targets | Account ID, existing Worker/trigger inventory, usage and intended Worker target; no deployed scheduler proven |
| Recovery | Separate DB/object backup and isolated acceptance procedures below | Named owner custodian, encrypted off-site destination, recovery-key store, isolated project or local recovery target, available capacity and retention/RPO/RTO decisions |

Available/deferred tool discovery exposed no usable provider management tools.
Plugin discovery found Supabase and Resend available but uninstalled in this
application; local MCP configuration is separate. Browser bootstrap initially
timed out; documented recovery returned an empty browser list. No OAuth was
repeated, plugin installed, credential store opened, or project adopted based
on an unrelated local reference. Recheck existing access when tools become
available before asking for reauthentication. Discovery did not read hosted
tables, migration history or logs.

Intended environments are production (three approved hosts, retained production
identity/data), compatibility (explicitly approved isolated data and independent
secrets), and build-only previews (no production runtime secrets). Do not put an
untrusted preview below `.silentrave.space`: the shared cookie reaches child
hosts. Compatibility on the real three hosts is an option only after proving
there is no existing production data/owner/session/traffic dependency and after
specific approval. Otherwise choose a separate controlled host arrangement.
An existing second Free project may consume the available isolated-project slot;
do not create/delete/upgrade a project to solve that without approval.

## Credential scopes and placement, with no values

| Identity/configuration | Intended scope and location |
| --- | --- |
| Resource metadata access | Existing authenticated connector/dashboard first. If a new scoped Supabase token is separately approved: only confirmed project, Project Settings Read; add only reviewed metadata capabilities. Account-wide project listing is a separate permission. No API Key Secrets, SQL, migration or write permission needed for this preparation. |
| Migration/backup operator | Named existing application object owner through TLS direct/session connection; secrets in an ACL-protected operator credential store, outside repository/build/runtime. Record role and endpoint identity without URL passwords. Backups require separately approved read access; deployment/migrations require separately approved writes. |
| Runtime PostgreSQL | Proposed dedicated LOGIN `sr_app` inheriting only the NOLOGIN `sr_runtime` privilege group, subject to collision/privilege inventory. No owner/superuser/BYPASSRLS/DDL/role administration. Production Functions `DATABASE_URL`, matching approved transaction pooler, TLS, `pgbouncer=true`, initial `connection_limit=1`. Existing credentials are not replaced speculatively. |
| Operator DIRECT_URL | Operator environment only. Builds get an unreachable placeholder; runtime receives no migrator credential. Readiness's offline complete-candidate check includes DIRECT_URL in the operator process, not the hosted app. |
| Hosting/auth | Provider runtime configuration: HOST_PLATFORM=netlify, ROOT_DOMAIN, PUBLIC_BASE_URL, exact current DEPLOY_ID and AUTH_INTERNAL_BASE_URL. Separate NETLIFY_INGRESS_SECRET and PROXY_AUTH_SECRET used by ingress/proxy/broker. Functions scope must include both Node and Edge where scope selection is available. |
| Storage | Node Functions only in application usage: SUPABASE_URL, SUPABASE_STORAGE_SERVER_KEY, SR_PRIVATE_BUCKET, SR_BANNER_BUCKET, STORAGE_DRIVER=supabase and preserved STORAGE_SIGNING_SECRET. Selected secret/service-role key is privileged project-level Storage access, not a bucket-scoped SQL runtime identity; do not claim RLS limits that server key. Never expose it to browsers. |
| Preserved application identity | STATUS_TOKEN_SECRET; TICKET_SIGNING_PRIVATE_KEY/KID and historical public-key inventory; EMAIL_PAYLOAD_SECRET; STORAGE_SIGNING_SECRET; RATE_LIMIT_SECRET. Owner-controlled recovery vault, production Functions only; do not rotate keys that retained tickets/links/jobs/objects/windows depend on. Scanner receives public verification keys only. |
| Email | Domain-restricted send-only Resend key where supported, server Functions; EMAIL_FROM/REPLY_TO, EMAIL_TRANSPORT=resend, payload key and Svix RESEND_WEBHOOK_SECRET. SMTP/Resend and push credentials absent during compatibility non-delivery acceptance. Contact also sends directly; disabling only the worker does not prevent it. |
| Scheduler | Distinct CRON_SECRET in Node Functions and Cloudflare Worker secret store; never query strings. Initially Worker not deployed/enabled, EMAIL_KICK_ENABLED=0. Production mail budgets 90/day, 2700/month, interval 600ms, RATE_LIMIT_DRIVER=postgres. |
| Optional providers | Leave VAPID private/Places keys unset until separately scoped review; production smoke must not trigger push. Public VAPID verification/Maps keys have separate public restrictions. |

Netlify Free may not provide selectable variable scopes: confirm the account UI,
use production-context values and blank/absent preview/branch overrides, and
retain the build sanitizer. Functions-scope settings are not per-function secret
isolation. No TOML or NEXT_PUBLIC secrets. Only reviewed tool/version values
belong in build.environment. The provider setting for Node Functions is
AWS_LAMBDA_JS_RUNTIME=nodejs24.x; Node24/Bun1.3.14 and pinned dependencies remain.
Runtime variable changes require a new deployment; a settings save alone is not
acceptance. Confirm immutable deploy-ID/broker-origin binding at each release:
do not reuse a previous deployment's broker origin or assume a build-only
DEPLOY_URL is visible in runtime. Any required provider interpolation/bootstrap
must be reviewed before deployment, with no secret embedding into public output.
[Node variables](https://docs.netlify.com/build/functions/environment-variables/),
[Edge variables](https://docs.netlify.com/build/edge-functions/environment-variables/)
and [deploy metadata](https://docs.netlify.com/build/configure-builds/environment-variables/)
define the provider boundaries; actual availability is unverified.

## Frozen migration inventory and reconciliation decision

SHA-256 of exact **Git blob (LF)** migration.sql bytes at verified main,
recomputed in preparation. All eight committed blobs match main; this follow-up
changes no SQL or migration history. Windows autocrlf produces different CRLF
worktree fingerprints despite identical content. The
[byte manifest](../reports/batch-c-migration-manifest.json) records both sets and
the independently checked content/committed-byte comparisons. Initial raw-byte
equality inspection failed on all eight; explicit CRLF-only comparison then
passed. Do not use an OS checkout's unreviewed checksums as the release freeze.

| Migration | SHA-256 |
| --- | --- |
| 20260930000000_v2_1_baseline | 04fa814984ddd86f735a32a365db6c78ecb09639632003e18cdcaaffa1318985 |
| 20261002000000_phase4_email_state | 0dec5e0af801bb216d37c74903ea36589aee9180f0c4df9087661e3a8cbb5463 |
| 20261002010000_step3_content_payment_snapshot | e73c1792d34d4a8b914ad8fbcc81305d1215793041f1d602cb1c5577f5d84bce |
| 20261003000000_step4_staff_password | 03ff7ea94a34bc1c2bd125e49ae4162c98de3744a3fcedd4ca5efcb576a95a9d |
| 20261006000000_step5_storage_accounting | e15c46c9df069f0c621c6d2ed7d6759ec0ca50354667968a7ff302d5afa6345f |
| 20261008000000_step5_shared_rate_limits | 68e8d95bc5b1a675267e1c9ca6af0020932834263c2e7225a8a2a62bb2e9bf73 |
| 20261008000100_step5_mail_quotas | 0f3c4dfb30ce22b31bbe96425deb17af1e8f5d4aec680a294db198f3c5917824 |
| 20261008000200_step5_private_runtime | 0eb3901304ed926e84a51ecae75a95acb0d77916f9026a54a25cb0f313f96002 |

Future operator execution must materialize the approved Git archive bytes in
an isolated directory and verify all eight raw hashes before Prisma runs.
On this Windows configuration plain git archive also converts line endings;
use the per-command `git -c core.autocrlf=false archive` override and inspect
the archive payload. This changes no global/repository config or source bytes.
Keep the normal checkout and historical migrations unchanged. An existing host
may have recorded CRLF fingerprints; compare both captured variants, but do
not relabel/repair an applied migration automatically. That discrepancy still
requires a separately reviewed history decision before applying any suffix.

After specific inventory approval, use a read-only operator transaction on the
named target to collect engine, project/DB identity, exact applied names/checksums,
finished/rolled-back states, schema owners, objects, roles/membership, table/column
ACLs/defaults/RLS, views/routines/sequences/triggers and aggregate retained-data
sizes. Compare owner/password/active state privately, emitting match booleans
and counts rather than hashes, customer data or session tokens. Preserve owner
and session state. Inventory extensions/custom operators too: the recent
[Supabase engine notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes)
can affect isolated restores; no engine upgrade, reindex or encryption rewrite
is authorized. Repository mail encryption uses application code, not pgcrypto
PGP; unknown hosted objects still require inspection.

Decision: an exact finished prefix means propose only its missing suffix. Full
eight means no migration. Empty/absent history with existing objects, divergent
checksums/owners/grants, unfinished rows or unknown runtime privileges means
stop and draft a separate reconciliation plan. A truly empty project still
needs initial provisioning approval. Never reset, db push, migrate dev, resolve
or replay baseline automatically. Storage pointers marked LEGACY_REFERENCED
need actual object inventory/import review, not path guessing or silent rewrite.
Run approved deployment only via pinned Prisma6.19.2 in a separate operator
environment; no migrations/seeds from a Netlify build. Read back final history
and verify fingerprints, permissions and constraints after separately approved
execution. Local fixture runners reject hosted URLs and must stay local.

## Separate encrypted backups and isolated recovery

Before approved production migrations/configuration, choose the backup owner,
off-site destination, encryption/key custody, retention and isolated target.
Proposed cadence: consistent pre-change DB/object snapshot, daily DB export,
daily immutable-object delta plus manifest, and fresh pre-event verification.
Proposed acceptance is RPO <=24h outside events and a measured event-day recovery
plan; RTO is undecided until an actual restore is timed. Owner must review these
commitments and event-day cadence before launch; no scheduled backup is created.

1. With separate backup approval, take a consistent logical DB export of the
   app schema/data/history and an ownership/ACL/sequence/extension manifest.
   Use a matching PostgreSQL client and private credential file/store, never
   a password on command line. Do not blindly restore Supabase platform schemas
   or cluster roles into another hosted project. Preserve staff/owner hashes,
   sessions, tier counters, tickets/status versions, audit/scan ledgers, worker
   fences, quota reservations, storage ledger and encrypted queued payloads.
2. Back up object bytes separately, including legacy and unreferenced evidence
   pending review, original key names, size/SHA-256/content-type/input-hash
   metadata, bucket definitions and policies. Reconcile DB pointers and ledger
   with the manifest. Record snapshot time and a final delta under an approved
   write pause or another explicitly reviewed consistent-snapshot procedure.
   No object deletion/import or production pointer rewrite is implied.
3. Encrypt both archives and their sensitive linkage manifest before off-site
   transfer using an owner-selected authenticated encryption tool. Proposed
   custody: owner holds recovery private key in a password-manager/offline
   store separate from the encrypted archives; operator gets the encryption
   public key only. Confirm a second owner-controlled recovery copy. Record
   non-secret key identifier, archive ciphertext hashes, access ACLs and date;
   keep plaintext exports out of Git/reports and uncontrolled temp folders.
   Application identity keys require a separate owner recovery-vault inventory.
4. Restore only into the named approved isolated recovery target. Deny provider
   egress, omit Resend/push credentials and cron triggers, and use controlled
   synthetic users for compatibility tests. Any retained production-data/key
   decryptability test runs in a private restricted recovery environment with
   explicit approval; do not put production data/keys into a public preview.
   Verify owner/password state equality privately, history/fingerprints,
   counters, ledgers/sequences, QR/public-key verification, status derivation,
   queued-payload decryptability and byte-for-byte proof/PDF/banner linkage.
   Rehearse the restricted runtime role, measure recovery time and capture fixed
   pass/fail labels. Do not send, renew production sessions or clear queued jobs.

Supabase DB backups omit object bytes, and Free does not supply the paid daily
backup guarantee. [Backup contract](https://supabase.com/docs/guides/platform/backups).
Current encrypted archives, custody and completed restore evidence: **MISSING**.

## Account usage and event-day load worksheet

Live account quotas/usage, retained sizes and expected peaks are **MISSING**.
Record billing cycle/reset, used/remaining amount, other applications/sites,
function memory allocation, visitors/page-assets, buyer polling duration,
peak orders/day and tickets/order, proof retries, contacts/lookups/resends,
scanner count/sync rates, concurrent gates and backup egress. Obtain owner
acceptance of delayed Free-tier mail; saved status links/PDF downloads remain
available independently, while lookup mail itself can be deferred.

For the current credit-based Free plan, model Netlify credits as
`15*productionDeploys + 2*requests/10000 + 20*deliveredGB + 10*GBhours`.
Two deploys + 300k requests + 2GB + 8GB-hours = 210 credits before other team
usage. Target <=225 of 300, leaving >=75 reserve. Two cron calls/minute produce
86,400 requests over 30 days: 17.28 request credits plus 36 compute credits
at an **assumed**, unmeasured 0.15s and 1GB each. At 0.5s, compute alone is 120.
Include broker calls, preview traffic, bots, private proxy egress and retries.
Legacy accounts may use a different plan; verify the actual team dashboard.
Review 50/70/80% usage and pre-event remaining capacity; at 80% halt unnecessary
builds/previews and recalculate. No purchases or automatic upgrade.
[Current Netlify rates](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/).

Supabase Free lists 500MB DB, 1GB objects, 5GB uncached egress and a separate
5GB cached allowance, two active projects and inactivity pauses. Plan below
300MB DB and retain 20% object headroom; measure encrypted/base64 payloads,
indexes/audit/scans/sessions, abandoned proofs and all prior events. Example
500 PDFs at 50KiB + 300 proofs at 250KiB + 5 banners at 300KiB = 101,888,000
additional bytes/month. Five hundred 3MiB proofs exceed 1GB. Review 60/75/80%
storage and an owner-approved contingency; retention/deletion is not approved.
Private reads and backup exports also consume egress.
[Current Supabase allowances](https://supabase.com/pricing).

Resend Free transactional allowance is 3,000/month and 100/day; application
limits remain 2,700/90 with resets at 00:00 UTC (01:00 Lagos). Include inbound
and other account usage. Example 250 orders*2 + 25 rejections + 50 lookups +
25 resends + 20 contacts = 620/month; 80 successful orders in one day require
about 160 base messages and exceed daily capacity. One recipient with up to
ten PDF attachments still counts as one ticket email. User peak and delay
acceptance are pending. [Resend pricing](https://resend.com/pricing) and
[quota rules](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
Cloudflare CPU/duration/error metrics and account trigger count remain missing;
the tiny two-fetch scheduler still needs measured acceptance against
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

## Frozen app, DNS/TLS and smoke/rollback actions

Freeze source/main, dependency locks, migration hashes, adapter5.16.2,
edge-bundler16.1.2, Node24/Bun1.3.14 and generated scanner/font/native manifests
at the eventually approved release head. The preparation branch does not alter
runtime source or dependencies. Record generated Edge ordering/ESZIP, Node ZIP,
build/native manifests, commit and SHA-256s, runtime environment version,
Netlify deploy ID, immutable broker origin and tested rollback candidate.
Changing adapter, dependencies or runtime config invalidates borrowed evidence.

A concrete local source freeze now exists at
`.test-runtime/batch-c-source-783893b.tar`: 27,893,760 bytes, SHA-256
`2d761b165c681c9e9f72558c9e0292e69a0404bd0dcbff82664dce814aceee59`.
It materializes verified main with the per-command autocrlf override. All eight
archived migration payloads were independently hashed and match the Git table.
[Source freeze manifest](../reports/batch-c-source-freeze.json) records that
acceptance. The initial plain archive failed byte acceptance and is preserved
under ignored `.test-runtime/batch-c-source-783893b-crlf.tar`, with its failed
check log. Neither archive is a packaged production deploy or a hosted rollback.

Passing baseline CI artifacts are **evidence**, not a production deploy artifact:

| Artifact ID | OS/attempt | Published digest |
| --- | --- | --- |
| 11540106955 | Linux retry/pass | eebbf00d90b0c024765f94c636b4a43da7c4d9afb6d7e689963000ca06b9b7d2 |
| 11539435962 | Windows/pass | 5ee08c62c7fed335868d020f1611ab03c30927da77b2c4d20478ca20f5bceadb |
| 11539500453 | Linux first attempt/failure, retained | ecedd339b098362324789dca0e9272f293122890398c1657a9ca4bc80a6a2ad1 |

GitHub returned these archive digests and unexpired status; archives were not
downloaded/rehashed in preparation. No frozen hosted deploy or tested hosted
rollback artifact exists yet. Select one after compatibility acceptance; do not
assume pre-privacy releases work with the restricted runtime. A first release
has no previously proven hosted rollback. Rehearse failure containment before
opening sales: approved closure of new checkout through existing owner tier
sales-end controls, retain paid proof intake and downloads, pause trigger via
approved Cloudflare action, retain all schema/queues/objects/keys, then republish
only a separately approved compatible artifact. No down-migration or reset.

Future DNS review: keep existing registrar DNS. Add the three hosts to the same
named Netlify site with root primary and admin/staff preserving identity. Use
the selected site's current apex ALIAS/A and admin/staff CNAME instructions,
not an inferred value from the current root A. Preserve MX/SPF/DKIM/DMARC/CAA;
Resend sender records are a separate reviewed set. Capture old and proposed
records/TTL and a DNS rollback table first. Validate propagation and certificate
SANs for all three hosts, HTTPS redirects, no mixed content and no blanket
canonical redirect collapsing admin/staff. Cookie must stay sr_session,
Secure/HttpOnly/SameSite=Lax/Path=/, Domain=.silentrave.space. Verify independent
host/Origin/role/temporary-password/renewal/RSC/cache denials through actual Edge
then Node; *.netlify.app alone does not prove this cookie contract.
[Provider external DNS instructions](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/).

Non-delivery smoke scope must be explicit about target and synthetic writes.
Public empty/sales-closed/pages/artwork checks, malformed/unknown-host/Origin
and unauthenticated broker/cron/webhook denials are read-only. Auth/login creates
sessions; upload/checkout/approval/refund/admission and pooler concurrency mutate
data and belong only to a separately approved isolated dataset. Before any such
checks, prevent every mail/contact/push send with blank credentials and provider
egress denial; production rejects capture and receives no escape hatch.
Do not call an authenticated live worker merely to test auth; existing queues
may send. Test genuine parallel pooler transactions/row/advisory/SKIP LOCKED,
shared quotas/limits and storage privacy/durability across invocations in the
isolated target. Runtime HTTP denial must supplement SQL-role/RLS evidence.
Actual recipient delivery, signed webhook delivery and physical devices are D.

`scheduler/wrangler.toml` already contains an active one-minute trigger. A normal
deployment could enable it immediately. Do not run it during preparation or
provisioning. A later reviewed deployment must use a trigger-free configuration
until a distinct enablement approval; production keys and the fixed root targets
must never be used for an unapproved compatibility fixture. Preserve 45s worker,
15s provider, 60s function/gate limits and 70s outbound scheduler deadlines;
review actual memory/CPU/staleness/latency before enabling. Monitor both endpoint
results and last successful processing; exact alert owner/channel is pending.

## Approval register and next input

These are distinct decisions, **none granted by this package or a PR merge**.
An approval must name environment, resource ID, action and permitted dataset;
record exact before/after expectations and stop on drift.

| Gate | Concrete reviewable next action | Prerequisites/status |
| --- | --- | --- |
| C0 target review | Confirm Netlify team/site, Supabase org/project, Resend team/domain, Cloudflare account, DNS owner and recovery custodian | Non-secret IDs/URLs missing; existing local Supabase candidate must be confirmed |
| C1 inventory | Read-only SQL/metadata/object inventory on confirmed production/recovery target, with redacted aggregate evidence; no writes/repair | Named SQL/data approval required; current preparation does not grant it |
| C2 backup/recovery | Encrypted DB export + separate object export to named off-site store; restore only to named isolated target | Snapshot/key custody/retention and exact restore dataset approved first |
| C3 provisioning/config | Named restricted login, two buckets/policies, Data API setting, runtime/context secrets and trigger-free scheduler resource | Review existing ownership/privileges, account usage, preview isolation and exact settings; no provisioning assumed |
| C4 migration | Only inventory-derived missing suffix of the eight frozen migrations, via named operator DIRECT_URL | Backups/restoration and drift review passed; approval names exact files/hashes/target |
| C5 DNS/provider | Exact reviewed root/admin/staff and sender records, host aliases/TLS and signed webhook registration | Old/new DNS diff, ownership, sender IDs and cookie/isolation arrangement confirmed; no delivery test |
| C6 compatibility | Frozen artifact + synthetic isolated dataset, explicit non-delivery writes and genuine multi-client acceptance | Named deploy/fixtures approval, delivery prevented, broker/deploy binding and budget verified |
| C7 production | Named frozen artifact, production environment version and read-only non-delivery smoke | Separate production deployment approval, compatible rollback/containment rehearsed, queues/data preserved |
| C8 scheduler | Enable reviewed trigger/secret on the named Worker | If it can process real queued mail, obtain explicit approval for that delivery effect; Batch D acceptance remains separate. No enablement in 5D.1. |
| D delivery/devices | Named recipient/event email/webhook/push and physical scanner/PWA/offline/gate evidence, then launch decision | Not begun or authorized; readyForLaunch remains false |

Next input is the existing Netlify site dashboard URL/team and confirmation of
the Silent Rave Supabase project URL/reference (including whether it already has
data/owner). Also identify Resend team/sender, Cloudflare account and preferred
isolated recovery target when available. Supply identifiers, never secrets.
After target confirmation, complete the register and present the exact named
read-only inventory approval first; do not request blanket rollout approval.
