// ─────────────────────────────────────────────────────────────────────────────
// Public site stub (route-group smoke test from the foundation phase).
//
// The real public site (event pages, checkout UI, status page) is a later
// phase — this phase is API-only by instruction ("DO NOT BUILD … any UI or
// styling of any kind, public event pages"). The manual-payment checkout flow
// is exercised by tests/phase3b over HTTP.
// ─────────────────────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <main>
      <h1>Silent Rave</h1>
      <p>Public route group (stub — the customer-facing site is a later phase).</p>
    </main>
  );
}
