"use client";
import { useState, type FormEvent } from "react";
export function LookupPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_code: String(form.get("code")).trim().toUpperCase(),
          email: String(form.get("email")).trim(),
        }),
      });
      if (r.status === 429)
        throw new Error("Too many requests. Please wait before trying again.");
      if (r.status !== 202)
        throw new Error("Could not request a link. Try again when connected.");
      setMessage(
        "If those details match an order, we have emailed its status link.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="narrow stack">
      <p className="eyebrow">FIND YOUR WAY BACK</p>
      <h1>Recover your order link</h1>
      <p>
        Use the order code and email you entered at checkout. If you still have
        your saved private link, open it directly to see your status without
        email.
      </p>
      <form onSubmit={submit} className="panel stack">
        <label>
          Order code
          <input
            name="code"
            placeholder="SR-XXXXXX"
            maxLength={32}
            autoComplete="off"
            required
          />
        </label>
        <label>
          Checkout email
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <button disabled={busy}>
          {busy ? "Requesting link…" : "Email my status link"}
        </button>
        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
