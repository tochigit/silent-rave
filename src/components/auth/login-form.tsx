"use client";

import { useState } from "react";

// Bare-minimum UNSTYLED login form (per build instruction — no design system,
// no visual polish; real visual design is a later phase).
//
// Posts to the single shared login endpoint; the server decides the redirect
// target from the authenticated role (+ intent), so the same component serves
// both the admin and staff login pages.

export function LoginForm({ intent }: { intent: "admin" | "staff" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, intent }),
      });
      const data: { ok?: boolean; error?: string; redirectTo?: string } =
        await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      // Full navigation (not router.push) so the new cookie is guaranteed to
      // be attached to the page request. "/admin" and "/staff" work both on
      // the subdomains (proxy double-prefix guard) and as direct dev paths.
      window.location.assign(data.redirectTo ?? "/");
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form method="post" onSubmit={onSubmit}>
      <label htmlFor="login-email">Email</label>
      <input
        id="login-email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label htmlFor="login-password">Password</label>
      <input
        id="login-password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </button>
      {error ? (
        <p role="alert" aria-live="polite">
          {error}
        </p>
      ) : null}
    </form>
  );
}
