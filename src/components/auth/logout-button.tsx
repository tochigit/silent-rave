"use client";

import { useState } from "react";

// Navigate only after the server confirms session revocation.

export function LogoutButton({ loginPath }: { loginPath: "/admin/login" | "/staff/login" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onLogout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("Logout failed");
      window.location.assign(loginPath);
    } catch {
      setError("Could not log out. Your session may still be active. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={onLogout} disabled={busy}>
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
}
