"use client";
import { useState } from "react";
export function PasswordForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        const form = e.currentTarget;
        const data = new FormData(form);
        try {
          const r = await fetch("/api/auth/password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              current_password: data.get("current_password"),
              new_password: data.get("new_password"),
            }),
          });
          const result = await r.json();
          if (!r.ok) throw new Error(result.error);
          form.reset();
          location.assign(result.redirectTo);
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Current temporary password
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label>
        New password
        <input
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={72}
          required
        />
      </label>
      <p>
        Use at least 12 characters. Changing it signs out your other sessions.
      </p>
      <button disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      <p role="alert">{message}</p>
    </form>
  );
}
