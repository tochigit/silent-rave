"use client";
import { useState, type FormEvent } from "react";
export function ContactForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Message failed. Try again.");
      setMessage(data.message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connection lost. Your fields are kept; try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="panel stack">
      <h2>Send a message</h2>
      <fieldset className="stack" disabled={busy}>
        <legend>Contact details</legend>
        <label>
          Name
          <input name="name" autoComplete="name" required maxLength={200} />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <label>
          Message
          <textarea name="message" minLength={10} maxLength={5000} required />
        </label>
      </fieldset>
      <button disabled={busy}>{busy ? "Sending…" : "Send message"}</button>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
