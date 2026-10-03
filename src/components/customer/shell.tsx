"use client";
import Link from "next/link";
import { useState } from "react";
import { CartLink } from "./cart";
export function BuyTickets({ className = "button" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/events/next-upcoming", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json();
      window.location.assign(
        data.result === "single"
          ? `/event/${encodeURIComponent(data.event.slug)}#tickets`
          : `/events?filter=upcoming${data.result === "none" ? "&empty=1" : ""}`,
      );
    } catch {
      setError("Could not load events. Try again.");
      setBusy(false);
    }
  }
  return (
    <span className="cta">
      <button className={className} onClick={go} disabled={busy}>
        {busy ? "Finding your night…" : "Buy tickets"}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
export function Header() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Silent Rave home">
          SILENT<span>RAVE</span>
          <span className="brand-dot" aria-hidden="true" />
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/events">Events</Link>
          <Link href="/about">About</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/lookup">Find order</Link>
          <CartLink />
        </nav>
        <BuyTickets className="button compact" />
      </header>
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <Link className="brand" href="/">
        SILENT<span>RAVE</span>
      </Link>
      <p>Choose your night. Bring your people.</p>
      <nav aria-label="Footer">
        <Link href="/events">Events</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/lookup">Recover order link</Link>
      </nav>
      <small>© {new Date().getFullYear()} Silent Rave</small>
    </footer>
  );
}
