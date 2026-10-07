"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useCart } from "./cart";
import { money } from "@/lib/customer/format";
export function CheckoutPage() {
  const { cart, save } = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cart || busy) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim().toLowerCase();
    const confirm = String(form.get("confirm_email")).trim().toLowerCase();
    if (email !== confirm) {
      setEmailError("Email addresses must match.");
      document.getElementById("confirm-email")?.focus();
      return;
    }
    setEmailError("");
    setError("");
    setBusy(true);
    const name = String(form.get("name")).trim();
    try {
      const r = await fetch("/api/checkout/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_id: cart.eventId,
          customer_name: name,
          customer_email: email,
          customer_phone: String(form.get("phone")).trim(),
          line_items: cart.lines.map((l) => ({
            tier_id: l.tierId,
            quantity: l.quantity,
            holder_names: Array.from(
              { length: l.quantity },
              (_, i) => l.holderNames[i]?.trim() || name,
            ),
          })),
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error || "Could not reserve tickets. Try again.",
        );
      save(null);
      window.location.replace(
        `/order/${encodeURIComponent(result.order_code)}?t=${encodeURIComponent(result.status_token)}`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connection lost. No payment is confirmed. Try again when connected.",
      );
      setBusy(false);
    }
  }
  return (
    <section className="narrow stack">
      <h1>Checkout</h1>
      <p className="muted">Enter your details. No account needed.</p>
      {!cart ? (
        <div className="panel">
          <p>Your cart is empty.</p>
          <Link className="button" href="/events">
            Choose tickets
          </Link>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2>{cart.title}</h2>
            {cart.lines.map((l) => (
              <p key={l.tierId}>
                {l.quantity} × {l.name} · {money(l.quantity * l.priceKobo)}
              </p>
            ))}
            <p className="total">
              Estimated total{" "}
              <strong>
                {money(
                  cart.lines.reduce((n, l) => n + l.priceKobo * l.quantity, 0),
                )}
              </strong>
            </p>
            <p className="muted">
              We’ll confirm ticket availability and your final amount before
              you pay. Bank transfer details appear in the next step.
            </p>
            <Link href="/cart">Review cart</Link>
          </div>
          <form onSubmit={submit} className="panel stack">
            <fieldset disabled={busy} className="stack">
              <legend>Your details</legend>
              <label htmlFor="buyer-name">
                Full name
                <input
                  id="buyer-name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={1}
                  maxLength={200}
                />
              </label>
              <label htmlFor="buyer-email">
                Email address
                <input
                  id="buyer-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
              <label htmlFor="confirm-email">
                Type email again
                <input
                  id="confirm-email"
                  name="confirm_email"
                  type="email"
                  autoComplete="off"
                  required
                  maxLength={254}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? "email-error" : undefined}
                />
              </label>
              {emailError && (
                <p id="email-error" role="alert" className="error">
                  {emailError}
                </p>
              )}
              <label htmlFor="buyer-phone">
                Phone number
                <input
                  id="buyer-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  pattern="\+?[0-9]{7,15}"
                  placeholder="e.g. +2348012345678"
                  maxLength={16}
                  required
                />
                <small>7–15 digits, with an optional +.</small>
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy}>
              {busy
                ? "Reserving tickets…"
                : "Reserve tickets & get bank details"}
            </button>
            <p className="muted">
              You’ll have 15 minutes to submit a receipt. A receipt is evidence
              for review; only owner approval confirms payment and creates
              tickets.
            </p>
          </form>
        </>
      )}
    </section>
  );
}
