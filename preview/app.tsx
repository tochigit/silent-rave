import { createRoot } from "react-dom/client";
import { Header, Footer } from "../src/components/customer/shell";
import { CartProvider, CartPage } from "../src/components/customer/cart";
import { EventsBrowser } from "../src/components/customer/events-browser";
import { EventDetailPage } from "../src/components/customer/event-detail";
import { CheckoutPage } from "../src/components/customer/checkout";
import { ContentPage } from "../src/components/customer/content-page";
import { LookupPage } from "../src/components/customer/lookup";
import Home from "../src/app/(public)/page";
import { installPreviewData, previewEvents } from "./fixtures";
import { PublicTheme } from "../src/components/customer/theme";

installPreviewData();
const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
function Page() {
  if (pathname === "/") return <Home />;
  if (pathname === "/events") return <EventsBrowser />;
  if (pathname.startsWith("/event/")) return <EventDetailPage slug={decodeURIComponent(pathname.slice(7))} />;
  if (pathname === "/cart") return <CartPage />;
  if (pathname === "/checkout") return <>
    <div className="preview-note narrow"><strong>Sample checkout</strong><p>Choose tickets to see the checkout layout. Reservations and payments are disabled. Use sample details only.</p><a href={`/event/${previewEvents[0].slug}#tickets`}>Choose sample tickets</a></div>
    <CheckoutPage />
  </>;
  if (pathname === "/about" || pathname === "/contact") return <ContentPage slug={pathname.slice(1) as "about" | "contact"} />;
  if (pathname === "/lookup") return <><div className="preview-note narrow">Order recovery is disabled in this preview. No emails are sent.</div><LookupPage /></>;
  return <section className="panel narrow"><h1>Page unavailable</h1><p>This page is not part of the design preview.</p><a className="button" href="/">Back to Silent Rave</a></section>;
}

createRoot(document.getElementById("root")!).render(
  <CartProvider><PublicTheme>
    <aside className="preview-banner" aria-label="Design preview"><strong>Design preview</strong><span>Sample event · Reservations, payments and messages disabled</span></aside>
    <Header /><main id="main" className="site-main" tabIndex={-1}><Page /></main><Footer />
  </PublicTheme></CartProvider>,
);
