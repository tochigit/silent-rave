# Step 4: owner operations, staff and offline-capable scanner

Status: IN PROGRESS. User authorized merging PR #3 and beginning Step 4 on 2026-10-03. PR #3 was squash-merged at 8984f9eccff51ff96088155e47e9afeef0c4d633 after exact-head Windows/Linux/security checks passed. Branch: feat/step4-owner-staff-scanner, based on that current main. All earlier branches retained. No Step 5 or deployment authorization.

Scope: owner management and payment operations, staff accounts and password reset, owner notifications with polling, CASH/COMP and reconciliation, audit and check-in review, staff attendee tools, online atomic check-in and REQUIRED offline preparation/verification/outbox/sync. Preserve .docs v2.1.2 and prior business invariants.

Scanner guidance agreed with the user: multiple scanners may operate online. During a connectivity outage, use one offline scanner for the whole event; one offline device per gate still permits cross-gate double admission. Sync automatically and manually when service returns. Surface manifest age, pending scans, refund staleness and conflicts honestly.

Validation has not yet run for Step 4. Hosted integrations, real email/push, physical camera/iOS, production storage, deployment and migrations remain unverified. No credentials or hosted data will be changed to manufacture a pass.

## Progress checkpoint

Implemented initial owner/staff screens and APIs, CASH/COMP issuance with inventory/idempotency/audit, CSV export, staff first-password-reset migration, online check-in and batch/manifest APIs, pure-JS browser Ed25519 verification, IndexedDB outbox, generic cached PWA shell, camera/image/manual decoding, push capture/dispatch and Google Places proxy/fallback.

Local dependency install: npm additions succeeded; Bun lockfile updated but install reported a lifecycle ENOENT and left local packages incomplete. A locked npm ci restored packages (621 packages, exit0; 27 minutes on this workspace). Initial syntax/type failures were fixed. Both app and tooling types passed before the subsequent scanner hardening; final checks pending. Scanner assets built successfully once. New migration applied to the disposable fixture. Focused local acceptance is currently in startup; no assertion pass is claimed. Browser plugin setup returned no available browser and discovery was empty; established owned-Chrome fixture fallback is prepared.

New dependencies are pinned @noble/ed25519 3.0.0, @noble/hashes 2.0.1, jsqr 1.4.0, web-push 3.6.7 and @types/web-push 3.6.4. Existing dependency versions are preserved. Prettier is temporary and ignored. New production scanner assets are built from source, contain no private data, and are ignored generated outputs.
