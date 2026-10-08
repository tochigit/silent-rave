# Batch B complete for code review

2026-10-08, Africa/Lagos. Consolidated 5C.4 + 5C.5 + 5C.6 is implemented on
`feat/step5c-shared-controls-release` in [PR #10](https://github.com/tochigit/silent-rave/pull/10).
PR #9 was authorized and squash-merged as
`b3e511525290c7b754ed995c77344954d1fd02c6`; post-merge CI
[37698983388, attempt 2](https://github.com/tochigit/silent-rave/actions/runs/37698983388)
passed Windows and Linux. Main remains at that merge. Batch B remains unmerged.

Shared PostgreSQL rate limits cover all eight protected callers and fail closed
before their mutations. Versioned HMAC identities hide normalized keys; atomic
database-time counters share the first-request window across instances. The
limiter clock uses the same millisecond precision as stored expiry values,
so a newly started window cannot produce an extra Retry-After second.

Contact and queued order mail share fenced sending and conservative UTC day/month
reservations. Exhaustion defers untouched jobs; ambiguous provider outcomes retain
counts and immutable retry payloads. The fixed two-target Cloudflare scheduler is
source only. Three additive migrations protect all 21 application tables and
migration history with precise runtime privileges and RLS; unexpected ownership,
membership, objects, policies and ACLs block migration. Historical migration
bytes are preserved. Approved buyers poll every 60 seconds, active states every
eight seconds; hidden/disabled views, backoff, manual refresh and abort fences
are verified. Readiness, usage, backup/restore and release instructions are in
[the operational contract](11-shared-controls-release.md).

## Passed verification

Verified implementation head: `c307eb270a423e010c5e52bc67127fd2d1c848f0`.
[CI 37749443373](https://github.com/tochigit/silent-rave/actions/runs/37749443373)
completed successfully on Windows and Linux; GitGuardian passed for that head.
Publication after this evidence-only update is recorded in the Desktop
`Silent Rave - Batch B continuation.md` and PR #10; recheck their current head.

| Check | Result and scope |
| --- | --- |
| Full guarded `test:step5b` | 221 passed, zero failed on each OS, through restricted runtime connections. |
| Readiness and runtime policy | Eight tests each, zero failed on each OS; independent route guards passed. |
| Lint and application/tooling types | Passed on both OSes. |
| Scanner and offline Netlify build | Passed on both OSes. Generated Edge execution and packaged Node 24 Prisma/Sharp/font/auth/PDF/QR checks passed. |
| Migration preflights | Fresh eight-migration chain/checksums, repeated no-op deployment, transaction locks, existing storage pointers and owner state passed on both OSes. |
| Actual receipt/banner browser flows | Passed in owned Linux Chrome, including preparation, 413 retry and saved fields. |
| Polished static preview | 59 owned Linux Chrome checks passed: responsive navigation, mobile hamburger, both themes, focus/keyboard, dialog/forms/cart and no backend traffic. |
| Rendered polling | Ten owned Linux Chrome checks passed. The same ten checks passed locally in owned Windows Chrome, without external requests or JavaScript errors. |
| Focused local controls | 24 passed, zero failed, 210 assertions after the final precision fix; owned fixture cleanup completed. |

The full runner's two conditional skips are accounted for separately: limiter
outage is exercised in its dedicated restricted app, and the receipt/banner test
is exercised in the owned Linux browser step. Failed post-commit kicks have their
own two passing cases. Browser CI steps are intentionally Linux-only; this is
not physical-device or hosted acceptance.

Machine-readable CI evidence: [verification summary](../reports/step5b-ci-verification.json).
Local evidence: [controls output](../reports/step5b-controls-win32-test-output.txt),
[polling result](../reports/step5b-win32-polling-browser.json) and
[measurements](../reports/step5b-win32-measurements.json). Latest ten-ticket local
fixture measured 253,300 base64 attachment bytes, 11,981 ms preparation and
10,229,439 database bytes, with one recipient. These are disposable local
measurements; hosted performance and provider usage remain unverified.

## Earlier failed or incomplete attempts

The first focused run had 18 passes and two failures because Bun rejected
PrismaPromise rejection assertions. Native Promise wrappers corrected this;
[the failed output](../reports/step5b-controls-win32-first-failure.txt) is retained.

Earlier CI attempts exposed and corrected four issues:

- Production packaged tests inherited a local memory limiter; the harness now
  uses shared counters and a restricted login (run 37708934649).
- RLS-redacted unique-error details made duplicate proof references return 500;
  post-rollback resolution through the same restricted client restores the
  existing 409/audit behavior and retains the atomic unique index (37709484809).
- Windows tried replacing a loaded Prisma DLL between fresh database groups;
  generation now runs once per fixture runner (37709944197).
- Sub-millisecond database time rounded expiry upwards, yielding Retry-After 601
  in a 600-second window; matching timestamp precision fixed the cause without
  weakening the upper-bound assertion (37724416733).

The first post-merge Linux PDF check detected a spurious 1D barcode beside the
correct QR. QR-only decoding retains the exact stored-token assertion.

Local ordinary Node lint stalled and was stopped; that attempt is incomplete.
Local full-regression setup and app-readiness timeouts are also incomplete,
with [setup](../reports/step5b-win32-setup-incomplete.txt) and
[readiness](../reports/step5b-win32-readiness-incomplete.txt) evidence retained.
They are not reported as passes; completed CI provides the full checks above.
The in-app browser was unavailable after documented recovery, so the existing
owned isolated Chrome harness performed browser verification. The PC shutdown
preserved the branch, commits, reports and preview; obsolete process IDs were
not reused.

## Review and remaining gates

The client's original poster/reference styling, lively mint/purple theme,
visible desktop links, mobile hamburger below 960 px and saved light/dark choice
are preserved. The Desktop Polished Preview v1 ZIP remains 230,875 bytes with
SHA256 `8defe66a8039604c95023da497629619e38a211435ee40a6dc5b4fc6c2577f58`.
All earlier preview packages and branches remain available.

No hosted query/migration, provider or DNS change, deployment, real message,
purchase or permanent owner change was performed. Scheduler source is not
deployed. Hosted preview accessibility, pooler behavior, REST/GraphQL denial,
backup restoration, account usage, delivery and physical-device rehearsal remain
separate approval and acceptance gates. Stop for Batch B review: do not merge
PR #10 or begin Batch C/D automatically. `readyForLaunch=false` remains.
