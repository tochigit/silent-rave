# Silent Rave checkpoint

Updated 2026-10-02, Africa/Lagos. Current specification: .docs v2.1.2.

## Delivery and settled decisions

1. Imported baseline verification: COMPLETE, PR #1 merged at
   982eb9f7f3af0d1ebdcac6456e176a6c8a71fe57.
2. Phase 4 email/PDF/refund/resend/webhook backend: implementation verified
   locally; publication and PR/platform CI gate in progress.
3. Customer experience: public events, checkout/status, editable About/Contact.
4. Owner/staff operations, including REQUIRED offline scanner.
5. Hosted integration and deployment acceptance.

Only Step 2 is authorized. Stop for PR review; no merge or later milestone.
Keep all branches. Guest buyers, manual transfer, OWNER approval alone creates
units/QRs. Next.js full-stack is settled. Preserve prototype dark/mint/purple
visual intent for later UI. Vercel Free, Supabase, Resend and intended Namecheap
silentrave.space remain selected; domain is not purchased. No service connection,
paid upgrade, hosted mutation or real email was performed.

## Current branch and implementation

Branch: feat/phase4-email-tickets-refunds; base origin/main 982eb9f.
Original main and chore/import-and-verify-baseline retained locally/remotely.
Live PR #1 merge verified. No applicable AGENTS.md found at start. Entire outside
Phase 4 continuation and embedded brief read; contradictions recorded in
.docs/PHASE4_REPORT.md. This checkpoint supersedes the old pre-merge state.

Phase 4 items 1-12 are implemented: fail-closed config; direct Resend HTTPS and
private capture; leased SKIP LOCKED queue with DB-wide pacing, encrypted immutable
retry payloads and finite retention cutoff; four React Email templates; pure
directions; embedded-font ticket PDFs and input-hash private cache/downloads;
status PDF links; password-confirmed atomic refunds; shared hourly resends;
owner job DTOs; raw-body Svix webhook; authenticated cron, post-commit kicks and
dev capture loop. Forward migration adds queue state/gate; baseline preserved.

## Verification

- Fresh Step 0: 112 pass, zero fail, eight files, runner exit 0, cleanup complete.
  Full reports/phase3b-win32-test-output.txt. Lock-order audit found no fix needed.
- Full Phase 3b + Phase 4: 145 pass/zero fail in 17 files plus two pass/zero fail
  in a separate app with failing kicks/missing secrets. Total 147. Runner exit 0,
  cleanup complete. Full reports/phase4-win32-test-output.txt, also copied to
  reports/phase4-test-output.txt. All original baseline test files unchanged.
- Final ticket PNG visually inspected; embedded diacritics, Lagos offset,
  unconfirmed date, cache regeneration and exact QR decode pass.
- ESLint PASS via direct Bun entry, no findings. Standard Node attempts
  INCOMPLETE locally after slow Windows loading; CI runs the standard command.
- Final both TypeScript checks PASS; production build PASS (loopback config).
  Font verified in standalone output. Full reports/phase4-{lint,typecheck,build}-output.txt.
- Windows/Linux CI and PR publication pending.
- Earlier failed runs are retained separately and explained in the report.
  Test/fixture fixes preserved business assertions; no failure called a pass.

Tests use isolated loopback PostgreSQL, real Next HTTP/sharp/local private storage,
React Email/PDF rendering, real Svix signatures and Python QR decoding. Resend
transport is fake/capture; worker time/random/sleep injected or rows backdated.
No real send or production secret was needed. Root .env absent. Test app/database
stopped; all local check processes exited (inspect live state on resume).

## Next action

Local checks, standalone font/process cleanup and diff/secret review are complete.
Full report includes all Step 0/combined output and launch gaps. Commit/push this branch,
open focused PR to main and verify BOTH platforms on its current head. Record
PR/check evidence here, then STOP FOR REVIEW. Do not merge or start Step 3.

Supabase storage remains a stub; public/auth rate limiters remain in-memory.
Real DNS/DKIM/SPF, attachments/send/webhook, hosted pooler/locks/migrations,
durable storage, minute scheduler, host runtime/origins and deployment smoke
checks remain UNVERIFIED launch prerequisites. See .docs/PHASE4_REPORT.md.
