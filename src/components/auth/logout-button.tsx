"use client";

import { useState } from "react";

// Bare-minimum UNSTYLED logout control (auth plumbing, not UI design).
// Deletes the server-side session and bounces to the group's login page.

export function LogoutButton({ loginPath }: { loginPath: "/admin/login" | "/staff/login" }) {
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Session row may already be gone; still clear client-side state below.
    }
    window.location.assign(loginPath);
  }

  return (
    <button type="button" onClick={onLogout} disabled={busy}>
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
