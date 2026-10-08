# Batch B verification

Implementation in progress on feat/step5c-shared-controls-release.
PR #9 merged b3e511525290c7b754ed995c77344954d1fd02c6; exact-head post-merge
CI 37698983388 attempt 2 passed Windows/Linux. First Linux attempt failed PDF
verification from a spurious 1D barcode beside the correct QR. The new verifier
limits decoding to QR format and retains the exact stored-token assertion.

First isolated controls pass: 18 passed, two failed, 152 assertions. Both failures
were Bun rejecting PrismaPromise in a rejection assertion; native-promise wrappers
are corrected and the failed evidence is retained in the first-failure report.
Quota races, untouched-job deferral, definitive/ambiguous/crash outcomes, stale
fences, atomic counters, bounded cleanup and both mocked scheduler targets passed.
Ten actual PDFs: 254344 base64 attachment bytes, 9924ms preparation, 10172095-byte
disposable database. These are local measurements, not hosted performance evidence.

The corrected focused controls run passed 24 tests and 207 assertions. This
includes the restricted-role/API-role checks, migration drift guards, mail
acceptance contention, quota reset/Retry-After handling and payload bounds.
Final local measurement: 254600 base64 attachment bytes, 22255ms preparation,
10229439-byte disposable database. Hosted performance remains unverified.

The final regression now separates fixture operator imports from application
imports, so both HTTP and direct service code use the restricted runtime login.
Additional migration drift and rendered polling checks are prepared. The connected
browser was unavailable after documented recovery; the existing owned isolated
Chrome harness is the fallback. No new browser pass yet.

Prisma generation passed with project Node24 after Bun generation stalled and
was terminated; that stalled attempt is incomplete. Initial app/tooling types
found a boolean conversion and a mock fetch signature; both are corrected.
App/tooling types and full direct-Bun ESLint passed after those corrections.
The ordinary Node lint attempt stalled and was stopped; it is incomplete.
Final types/lint will include later contention and privacy additions.
Full restricted regression is running. Readiness/policy/preflights/Netlify/browser
checks remain pending.
No Batch B PR yet. All branches and Desktop preview packages are preserved.
No hosted changes, deployment or real messages. readyForLaunch=false.

See [the operational contract](11-shared-controls-release.md) for scope and gates.
