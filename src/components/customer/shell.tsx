"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { CartLink } from "./cart";
import { ThemeToggle } from "./theme";
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
      <button className={className} onClick={go} disabled={busy} aria-busy={busy}>
        {busy && <span className="loading-spinner" aria-hidden="true" />}
        {busy ? "Finding…" : "Buy tickets"}
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const ticker = "THE MOST ANTICIPATED EVENT IN EUA - ".repeat(3);
  const pathname = usePathname();
  const links = [
    ["/", "Home"], ["/events", "Events"], ["/about", "About"],
    ["/contact", "Contact"], ["/lookup", "Find order"],
  ];
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header" onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}>
        <Link className="brand" href="/" aria-label="Silent Rave home">SILENT<span>RAVE</span><i className="brand-dot" aria-hidden="true" /></Link>
        <nav id="main-navigation" aria-label="Main navigation" data-open={menuOpen} onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setMenuOpen(false);
        }}>
          {links.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href || (href === "/events" && pathname.startsWith("/event/")) ? "page" : undefined}>{label}</Link>)}
          <CartLink />
          <ThemeToggle />
        </nav>
        <BuyTickets className="button compact" />
        <button ref={menuButton} className="menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={(event) => {
          setMenuOpen(open => !open);
          if (!menuOpen && event.detail === 0) requestAnimationFrame(() => {
            document.querySelector<HTMLAnchorElement>("#main-navigation a")?.focus();
          });
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </header>
      <div className="ticker-wrapper" aria-label="The most anticipated event in EUA">
        <div className="ticker-content" aria-hidden="true">
          <span className="ticker-item">{ticker}</span>
          <span className="ticker-item">{ticker}</span>
        </div>
      </div>
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-brand"><Link className="brand" href="/">SILENT<span>RAVE</span></Link><p>Choose your night. Bring your people.</p></div>
      <nav aria-label="Footer">
        <Link href="/events">Events</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/lookup">Find order</Link>
        <CartLink />
      </nav>
      <p>Copyright © {new Date().getFullYear()}. All rights reserved.</p>
    </footer>
  );
}
