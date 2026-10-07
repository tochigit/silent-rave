import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { readFile, stat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";

const root = path.resolve("out/client-preview");
const evidence = path.resolve("reports/polished-design");
const runtime = path.resolve(".test-runtime");
await mkdir(runtime, { recursive: true }); await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(runtime, "preview-browser-"));
const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
const requests = []; const errors = []; const checks = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function contrast(foreground, background) {
  function luminance(color) {
    const channels = color.match(/\d+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
const build = { bundleSha256: hash(await readFile(path.join(root, "assets/preview.js"))), cssSha256: hash(await readFile(path.join(root, "assets/preview.css"))) };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpeg": "image/jpeg", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  requests.push({ pathname, method: req.method });
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
  // Read-only rendering of the client's source for visual comparison. Never run
  // its EmailJS/payment scripts or load its external iframe during acceptance.
  if (pathname.startsWith("/__reference/")) {
    let body;
    if (pathname === "/__reference/") {
      body = (await readFile("references/Rave.html", "utf8"))
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/src="WhatsApp[^"]+"/, 'src="poster.jpeg"')
        .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "");
    } else if (pathname === "/__reference/Rave.css") body = await readFile("references/Rave.css");
    else if (pathname === "/__reference/poster.jpeg") body = await readFile("references/WhatsApp Image 2026-09-22 at 12.58.45.jpeg");
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": pathname.endsWith(".css") ? types[".css"] : pathname.endsWith(".jpeg") ? types[".jpeg"] : types[".html"] });
    res.end(body); return;
  }
  let file = path.resolve(root, `.${decodeURIComponent(pathname)}`); let status = 200;
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try { if ((await stat(file)).isDirectory()) file = path.join(file, "index.html"); await stat(file); }
  catch { file = path.join(root, "404.html"); status = 404; }
  const body = await readFile(file);
  res.writeHead(status, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const port = await new Promise((resolve, reject) => {
  const probe = createPortProbe(); probe.once("error", reject); probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port; probe.close(error => error ? reject(error) : resolve(port));
  });
});
let chrome; let browser; let step = "launch";
try {
  chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  let launchError; chrome.once("error", error => { launchError = error; });
  const deadline = Date.now() + 120000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (launchError || Date.now() > deadline || chrome.exitCode !== null) throw new Error("Owned Chrome readiness failed");
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(60000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text()); });
  const external = [];
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  async function widthCheck(label) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
    checks.push(label);
  }
  step = "client reference comparison";
  await page.goto(`${base}/__reference/`);
  await page.getByAltText("Event Poster").evaluate(image => image.decode());
  await page.screenshot({ path: path.join(evidence, "mobile-reference.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(evidence, "desktop-reference.png"), fullPage: true });
  const reference = await page.evaluate(() => ({
    outer: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector(".container")).backgroundColor,
    width: document.querySelector(".container").getBoundingClientRect().width,
    titleSize: getComputedStyle(document.querySelector(".event-title")).fontSize,
    titleTransform: getComputedStyle(document.querySelector(".event-title")).textTransform,
    posterWidth: document.querySelector(".poster-container img").getBoundingClientRect().width,
    ticket: getComputedStyle(document.querySelector(".ticket-card")).backgroundColor,
    accent: getComputedStyle(document.querySelector(".ticket-card")).borderLeftColor,
    calendar: getComputedStyle(document.querySelector(".calendar-btn")).backgroundColor,
  }));
  step = "home and keyboard";
  await page.goto(base); await page.getByRole("heading", { name: "NUSA Evangel - Silent Rave", exact: true }).waitFor();
  await page.getByAltText("NUSA Evangel - Silent Rave poster").evaluate(image => image.decode());
  const actual = await page.evaluate(() => ({
    outer: getComputedStyle(document.querySelector(".public-site")).backgroundColor,
    card: getComputedStyle(document.querySelector(".poster-container")).backgroundColor,
    width: document.querySelector(".site-main").getBoundingClientRect().width,
    titleSize: getComputedStyle(document.querySelector(".event-title")).fontSize,
    titleTransform: getComputedStyle(document.querySelector(".event-title")).textTransform,
    posterWidth: document.querySelector(".poster-container img").getBoundingClientRect().width,
    ticket: getComputedStyle(document.querySelector(".ticket-card")).backgroundColor,
    accent: getComputedStyle(document.querySelector(".ticket-card")).borderLeftColor,
    calendar: getComputedStyle(document.querySelector(".calendar-btn")).backgroundColor,
  }));
  for (const key of ["card", "ticket", "accent", "titleTransform"]) {
    assert.equal(actual[key], reference[key], `Keep the reference's ${key} styling`);
  }
  assert.equal(actual.outer, "rgb(13, 15, 20)", "Restore the earlier dark brand background");
  assert.equal(actual.width, 1180, "Use available desktop space");
  assert.equal(actual.titleSize, "60px", "Keep expressive typography with a more compact desktop masthead");
  const accessiblePurple = actual.calendar;
  const channels = accessiblePurple.match(/\d+/g).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const purpleContrast = 1.05 / (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] + 0.05);
  assert(purpleContrast >= 4.5, "White calendar labels need accessible text contrast");
  checks.push("Reference purple enhanced to at least 4.5:1 white-label contrast");
  assert.equal(await page.locator(".home-hero, .hero-art, .frequency-ring, .detail-grid").count(), 0);
  const desktop = await page.evaluate(() => {
    const poster = document.querySelector(".poster-container").getBoundingClientRect();
    const copy = document.querySelector(".event-content").getBoundingClientRect();
    const image = document.querySelector(".detail-poster");
    return { posterRight: poster.right, copyLeft: copy.left, topDifference: Math.abs(poster.top - copy.top), imageRatio: image.width / image.height, naturalRatio: image.naturalWidth / image.naturalHeight };
  });
  assert(desktop.posterRight < desktop.copyLeft && desktop.topDifference < 2, "Poster and ticket content sit side by side on PCs");
  assert(Math.abs(desktop.imageRatio - desktop.naturalRatio) < .005, "Keep the complete original poster without cropping");
  checks.push("Reference poster, dark cards, mint ticket accent and uppercase title preserved in the blended design");
  checks.push("1180px PC layout with polished title and uncropped poster beside ticket content");
  const desktopBalance = await page.evaluate(() => {
    const masthead = document.querySelector(".event-header").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".buy-btn")].map(button => button.getBoundingClientRect().bottom);
    const description = document.querySelector(".event-description").getBoundingClientRect();
    return { mastheadHeight: masthead.height, ticketButtonsBottom: buttons, descriptionWidth: description.width, posterBottom: document.querySelector(".poster-container").getBoundingClientRect().bottom };
  });
  await page.screenshot({ path: path.join(evidence, "desktop-home.png"), fullPage: true });
  await page.screenshot({ path: path.join(evidence, "desktop-home-viewport.png") });
  console.log("Desktop balance:", JSON.stringify(desktopBalance));
  assert(desktopBalance.mastheadHeight < 240, "Masthead leaves room for the original event content");
  assert(desktopBalance.ticketButtonsBottom.every(bottom => bottom <= desktopBalance.posterBottom), "Ticket actions fit alongside the complete poster without a long empty column");
  assert(desktopBalance.descriptionWidth < 670, "Keep readable desktop line lengths");
  checks.push("Compact PC masthead, readable description and ticket actions balanced alongside the complete poster");
  await page.screenshot({ path: path.join(evidence, "desktop-home.png"), fullPage: true });
  await page.screenshot({ path: path.join(evidence, "desktop-home-viewport.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  const order = await page.evaluate(() => [".event-header", ".poster-container", ".event-description", ".calendar-dropdown", ".tickets-section", ".details-grid", ".venue-group"].map(selector => document.querySelector(selector).getBoundingClientRect().top));
  assert(order.every((value, index) => index === 0 || value > order[index - 1]), "Keep the reference's mobile event section order");
  checks.push("Mobile keeps the client's poster, description, calendar, tickets, details and venue order");
  await page.keyboard.press("Tab"); assert.equal(await page.locator(":focus").textContent(), "Skip to content");
  checks.push("Keyboard skip link and loaded first-party poster");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await widthCheck("375px home without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-home.png"), fullPage: true });
  for (const width of [320, 360, 390, 480, 768, 960, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 }); await widthCheck(`${width}px home without overflow`);
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    if (width < 960) {
      assert(await page.locator(".site-header").evaluate(header => {
        const brand = header.querySelector(".brand").getBoundingClientRect();
        const buy = header.querySelector(".cta").getBoundingClientRect();
        return brand.right <= buy.left - 7 && getComputedStyle(header.querySelector(".brand")).whiteSpace === "nowrap";
      }), "The mobile wordmark stays on one line without colliding with Buy tickets");
      assert(await navigation.isHidden(), `Mobile navigation starts collapsed at ${width}px`);
      const toggle = page.getByRole("button", { name: "Open navigation", exact: true });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      const target = await toggle.boundingBox(); assert(target.width >= 44 && target.height >= 44);
      await toggle.click();
      assert.equal(await page.getByRole("button", { name: "Close navigation", exact: true }).getAttribute("aria-expanded"), "true");
    } else {
      assert.equal(await page.getByRole("button", { name: "Open navigation", exact: true }).count(), 0);
    }
    const nav = await page.getByRole("navigation", { name: "Main navigation" }).evaluate(nav => {
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return [...nav.querySelectorAll("a")].map(link => { const rect = link.getBoundingClientRect(); return { text: link.textContent, height: rect.height, width: rect.width, top: rect.top, bottom: rect.bottom, visible: getComputedStyle(link).display !== "none", headerBottom: header.bottom }; });
    });
    assert.equal(nav.length, 6);
    assert(nav.every(link => link.visible && link.top >= 0 && link.bottom <= link.headerBottom && link.height >= 44 && link.width >= 44), `All six navigation links visible and touchable at ${width}px`);
    if (width < 960) {
      await page.getByRole("button", { name: "Close navigation", exact: true }).click();
      assert(await navigation.isHidden());
    }
    if ([768, 960, 1920].includes(width)) await page.screenshot({ path: path.join(evidence, `home-${width}.png`), fullPage: true });
  }
  checks.push("Mobile hamburger opens all six 44px navigation links; desktop retains visible top links from 960px");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement?.textContent === "Home");
  await page.keyboard.press("Tab");
  // Natural tab order can continue beyond the expanded navigation; Escape is
  // checked while focus is on one of its links.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "About", exact: true }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Open navigation");
  assert(await page.getByRole("navigation", { name: "Main navigation" }).isHidden());
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.screenshot({ path: path.join(evidence, "mobile-navigation-open.png") });
  checks.push("Mobile menu supports keyboard activation and Escape with focus returning to the hamburger");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "About", exact: true }).click();
  await page.getByRole("heading", { name: "About Silent Rave" }).waitFor();
  assert.equal(await page.locator('#main-navigation a[href="/about"]').getAttribute("aria-current"), "page");
  assert(await page.getByRole("navigation", { name: "Main navigation" }).isHidden());
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  // Fail only a delayed in-memory lookup to inspect busy/error feedback.
  // The original fixture fetch is restored before retry; no API traffic.
  await page.evaluate(() => {
    const fixtureFetch = window.fetch;
    window.fetch = async () => {
      window.fetch = fixtureFetch;
      await new Promise(resolve => setTimeout(resolve, 600));
      return new Response("{}", { status: 503 });
    };
  });
  await page.getByRole("button", { name: "Buy tickets", exact: true }).click();
  const finding = page.getByRole("button", { name: "Finding…", exact: true });
  assert(await finding.isDisabled());
  assert.equal(await finding.getAttribute("aria-busy"), "true");
  await widthCheck("320px busy header without overflow");
  await page.getByRole("alert").getByText("Could not load events. Try again.").waitFor();
  assert(await page.getByRole("button", { name: "Buy tickets", exact: true }).isEnabled());
  checks.push("Buy tickets shows busy feedback, fails visibly and permits a safe in-memory retry");
  await page.getByRole("button", { name: "Buy tickets", exact: true }).click();
  await page.waitForURL(/\/event\/nusa-evangel-silent-rave\/?#tickets/);
  await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  assert.equal(await page.locator(":focus").getAttribute("id"), "tickets");
  checks.push("Menu links navigate and close the menu, active page is marked and Buy tickets opens the event ticket section");
  await page.getByText("Add to calendar", { exact: false }).click();
  await page.getByRole("link", { name: "Google Calendar", exact: true }).waitFor(); await widthCheck("320px calendar dropdown without overflow");
  await page.locator(".calendar-dropdown summary").focus();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator(".calendar-dropdown summary").evaluate(summary => getComputedStyle(summary).outlineStyle), "solid");
  checks.push("Reference calendar dropdown works on a 320px phone");
  await page.getByText("Add to calendar", { exact: false }).click();
  step = "ticket selection and persistence";
  await page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true }).click();
  await page.getByRole("dialog", { name: "Buy Early Bird Ticket", exact: true }).waitFor();
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  assert(await page.getByRole("dialog").evaluate(dialog => dialog.contains(document.activeElement)), "Keyboard focus stays inside the dialog");
  await page.getByRole("button", { name: "Add one Early Bird Ticket" }).click();
  assert.equal(await page.getByLabel("Early Bird Ticket quantity").textContent(), "2");
  await page.getByText("Optional holder names · Early Bird Ticket").click(); await page.getByLabel("Ticket 1 holder").fill("Preview Guest");
  await widthCheck("320px ticket modal without overflow");
  const touchSizes = await page.getByRole("dialog").locator("button").evaluateAll(buttons => buttons.map(button => ({ w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height })));
  assert(touchSizes.every(size => size.w >= 44 && size.h >= 44));
  await page.screenshot({ path: path.join(evidence, "mobile-ticket-modal.png") });
  await page.setViewportSize({ width: 812, height: 375 });
  const modalFit = await page.getByRole("dialog").evaluate(dialog => {
    const bounds = dialog.getBoundingClientRect();
    dialog.scrollTop = dialog.scrollHeight;
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  });
  assert(modalFit, "The modal must fit a short landscape viewport and scroll internally");
  await page.getByRole("button", { name: "Add 2 tickets to cart" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "landscape-ticket-modal.png") });
  await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "Buy Early Bird Ticket");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.equal(await page.getByLabel("Early Bird Ticket quantity").textContent(), "2");
  for (let count = 0; count < 8; count++) await page.getByRole("button", { name: "Add one Early Bird Ticket" }).click();
  assert(await page.getByRole("button", { name: "Add one Early Bird Ticket" }).isDisabled());
  assert.equal(await page.getByLabel("Early Bird Ticket quantity").textContent(), "10");
  for (let count = 0; count < 8; count++) await page.getByRole("button", { name: "Remove one Early Bird Ticket" }).click();
  checks.push("Mobile purchase modal, 44px touch targets, optional names, Escape and focus return");
  checks.push("Short landscape modal scrolls and the ten-ticket limit is enforced");
  await page.getByRole("button", { name: "Add 2 tickets to cart" }).click();
  await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
  await page.getByLabel("Full name").waitFor();
  assert.equal(await page.getByRole("button", { name: "Reserve tickets & get bank details" }).isDisabled(), true);
  assert.match(await page.locator("main").textContent(), /1,000\.00/);
  await page.setViewportSize({ width: 360, height: 800 }); await widthCheck("360px checkout without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-checkout.png"), fullPage: true });
  await page.getByLabel("Full name").fill("Preview Guest"); await page.getByLabel("Email address", { exact: true }).fill("guest@example.invalid");
  await page.getByLabel("Type email again").fill("guest@example.invalid"); await page.getByLabel("Phone number").fill("+2348000000000");
  await page.locator("form").evaluate(form => form.requestSubmit());
  assert.match(page.url(), /\/checkout/);
  const blocked = await page.evaluate(async () => (await fetch("/api/checkout/initialize", { method: "POST", body: "{}" })).status);
  assert.equal(blocked, 403); checks.push("No reservations or payment submission, including programmatic form submit");
  await page.goto(`${base}/cart/`); await page.getByRole("heading", { name: "NUSA Evangel - Silent Rave" }).waitFor();
  assert.match(await page.locator("main").textContent(), /2 × Early Bird Ticket/); checks.push("Cart persists through document navigation");
  await page.getByRole("button", { name: "Clear cart" }).click(); await page.getByText("Your cart is empty. Find a night to remember.").waitFor();
  checks.push("Clear cart works");
  step = "events and filtering";
  await page.goto(`${base}/events/`); await page.getByRole("heading", { name: "NUSA Evangel - Silent Rave" }).waitFor();
  await widthCheck("360px event listing without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-events.png"), fullPage: true });
  await page.getByLabel("City", { exact: true }).fill("Abuja"); await page.getByRole("button", { name: "Show events" }).click();
  await page.getByRole("heading", { name: "No events to show" }).waitFor(); checks.push("Filters and empty state work");
  await page.goto(`${base}/events/?view=month&date=2026-11`);
  await page.getByRole("heading", { name: "November 2026" }).waitFor(); await widthCheck("360px month calendar without overflow");
  await page.getByRole("link", { name: "View events on 2026-11-11" }).click();
  await page.getByRole("heading", { name: "NUSA Evangel - Silent Rave" }).waitFor(); checks.push("Month to day calendar navigation works");
  step = "static information and disabled message/recovery forms";
  await page.goto(`${base}/about/`); await page.getByRole("heading", { name: "About Silent Rave" }).waitFor(); await widthCheck("360px About without overflow");
  await page.goto(`${base}/contact/`); await page.getByRole("heading", { name: "Contact", exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Send message" }).isDisabled()); await widthCheck("360px Contact without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-contact.png"), fullPage: true });
  await page.goto(`${base}/lookup/`); await page.getByRole("heading", { name: "Recover your order link" }).waitFor();
  assert(await page.getByRole("button", { name: "Email my status link" }).isDisabled()); await widthCheck("360px Find Order without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-lookup.png"), fullPage: true });
  checks.push("Contact and recovery forms visibly disabled");
  await page.goto(`${base}/event/nusa-evangel-silent-rave/`); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor(); await widthCheck("360px event detail without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-event.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(evidence, "desktop-event.png"), fullPage: true });
  await page.setViewportSize({ width: 812, height: 375 }); await page.emulateMedia({ reducedMotion: "reduce" }); await widthCheck("Landscape with reduced motion without overflow");
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Cart, 0 tickets" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "landscape-navigation-open.png") });
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  checks.push("Short landscape keeps mobile menu links reachable through natural page scrolling");
  assert.equal(await page.locator(".ticker-content").evaluate(ticker => getComputedStyle(ticker).animationName), "none");
  checks.push("Reduced-motion ticker respects the visitor preference");
  const reducedTransitions = await page.locator(".buy-btn, .calendar-btn").evaluateAll(controls => controls.map(control => getComputedStyle(control).transitionDuration));
  assert(reducedTransitions.every(duration => duration === "0s"));
  checks.push("Reduced motion disables button and calendar transitions as well as the ticker");
  await page.setViewportSize({ width: 640, height: 900 });
  await page.locator("html").evaluate(html => { html.style.zoom = "2"; });
  await widthCheck("200 percent zoom at an effective 320px width without overflow");
  await page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Close ticket selection" }).click();
  await page.locator("html").evaluate(html => { html.style.zoom = ""; });
  checks.push("200 percent zoom keeps the event and ticket dialog usable");
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 1000 });
    for (const route of ["", "events", "about", "contact", "lookup", "cart", "checkout"]) {
      await page.goto(`${base}/${route ? route + "/" : ""}`); await page.locator("main h1").waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route || "home"} fits at ${width}px`);
      if (route === "about" || (width === 1440 && route)) await page.screenshot({ path: path.join(evidence, `${width === 320 ? "mobile" : "desktop"}-${route}.png`), fullPage: true });
    }
  }
  checks.push("Home, listings, information, contact, recovery, cart and checkout fit at 320px and 1440px");
  await page.goto(base); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  const buy = page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true });
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => !document.querySelector(".buy-btn").matches(":hover"));
  const restColor = await buy.evaluate(button => getComputedStyle(button).backgroundColor);
  await buy.hover();
  // Chromium can apply pointer pseudo-classes on the next rendering frame.
  // Wait for the actual style change rather than sampling the dispatched event.
  await page.waitForFunction(background => getComputedStyle(document.querySelector(".buy-btn")).backgroundColor !== background, restColor);
  const hoverColor = await buy.evaluate(button => getComputedStyle(button).backgroundColor);
  await page.mouse.down();
  await page.waitForFunction(background => getComputedStyle(document.querySelector(".buy-btn")).backgroundColor !== background, hoverColor);
  const pressedColor = await buy.evaluate(button => getComputedStyle(button).backgroundColor);
  await page.mouse.up(); await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.notEqual(restColor, hoverColor); assert.notEqual(hoverColor, pressedColor);
  checks.push("Mint ticket buttons give distinct hover and pressed feedback without moving layout");
  step = "light theme and remembered preference";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Switch to light theme", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".public-site").dataset.theme === "light");
  const themeContrasts = await page.evaluate(() => {
    const site = document.querySelector(".public-site");
    const background = getComputedStyle(site).backgroundColor;
    return [
      { label: "Light body", foreground: getComputedStyle(site).color, background },
      ...[".event-description", ".experience-title", ".tickets-title"].map(selector => ({ label: selector, foreground: getComputedStyle(document.querySelector(selector)).color, background })),
      { label: "Light ticket availability", foreground: getComputedStyle(document.querySelector(".ticket-card .subtext")).color, background: getComputedStyle(document.querySelector(".ticket-card")).backgroundColor },
      { label: "Purple calendar", foreground: getComputedStyle(document.querySelector(".calendar-btn")).color, background: getComputedStyle(document.querySelector(".calendar-btn")).backgroundColor },
      { label: "Light preview label", foreground: getComputedStyle(document.querySelector(".preview-banner strong")).color, background: getComputedStyle(document.querySelector(".preview-banner")).backgroundColor },
    ];
  });
  for (const pair of themeContrasts) { pair.ratio = contrast(pair.foreground, pair.background); assert(pair.ratio >= 4.5, `${pair.label} needs 4.5:1 contrast`); }
  await page.screenshot({ path: path.join(evidence, "desktop-light-home.png"), fullPage: true });
  await page.screenshot({ path: path.join(evidence, "desktop-light-home-viewport.png") });
  checks.push("Light theme keeps mint/purple identity with at least 4.5:1 body, muted, ticket and calendar contrast");
  await page.goto(`${base}/about/`); await page.getByRole("heading", { name: "About Silent Rave" }).waitFor();
  assert.equal(await page.locator(".public-site").getAttribute("data-theme"), "light");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(base); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, "mobile-light-home.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Switch to dark theme", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator(".public-site").getAttribute("data-theme"), "dark");
  await page.getByRole("button", { name: "Switch to light theme", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.screenshot({ path: path.join(evidence, "mobile-light-navigation-open.png") });
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  checks.push("Theme choice persists across document navigation and toggles by keyboard inside the mobile menu");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await widthCheck("320px light ticket dialog without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-light-ticket-modal.png") });
  await page.getByRole("button", { name: "Add 1 ticket to cart", exact: true }).click();
  for (const width of [320, 768, 812, 960, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 812 ? 375 : 900 });
    await widthCheck(`${width}px light event without overflow`);
  }
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 1000 });
    for (const route of ["events", "about", "contact", "lookup", "cart", "checkout"]) {
      await page.goto(`${base}/${route}/`); await page.locator("main h1").waitFor();
      assert.equal(await page.locator(".public-site").getAttribute("data-theme"), "light");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} fits in light theme at ${width}px`);
      if (["about", "contact", "checkout"].includes(route)) await page.screenshot({ path: path.join(evidence, `${width === 320 ? "mobile" : "desktop"}-light-${route}.png`), fullPage: true });
    }
  }
  checks.push("All supporting pages inherit the remembered light theme and fit at 320px and 1440px");
  await page.goto(base); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
  await page.reload(); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  assert.equal(await page.locator(".public-site").getAttribute("data-theme"), "dark");
  const blockedStorage = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await blockedStorage.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Disabled for acceptance", "SecurityError"); } }));
  const blockedPage = await blockedStorage.newPage();
  blockedPage.on("pageerror", error => errors.push(error.message));
  await blockedPage.goto(base); await blockedPage.getByRole("heading", { name: "Tickets", exact: true }).waitFor();
  await blockedPage.getByRole("button", { name: "Open navigation", exact: true }).click();
  await blockedPage.getByRole("button", { name: "Switch to light theme", exact: true }).click();
  assert.equal(await blockedPage.locator(".public-site").getAttribute("data-theme"), "light");
  await blockedStorage.close();
  checks.push("Dark preference survives reload; theme switching remains usable when local storage is blocked");
  step = "excluded routes and network isolation";
  const response = await page.goto(`${base}/admin/`); assert.equal(response.status(), 404);
  await page.getByRole("heading", { name: "Page unavailable" }).waitFor();
  assert.equal(requests.filter(request => request.pathname.startsWith("/api/") || request.method === "POST").length, 0);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  checks.push("No HTTP API calls, POSTs, external requests or JavaScript errors; admin route excluded");
  assert.equal(hash(await readFile(path.join(root, "assets/preview.js"))), build.bundleSha256);
  assert.equal(hash(await readFile(path.join(root, "assets/preview.css"))), build.cssSha256);
  await writeFile(path.join(evidence, "acceptance.json"), JSON.stringify({ result: "PASS", checks, reference, actual, desktop, desktopBalance, themeContrasts, build, errors, externalRequests: external.length, apiRequests: 0, pages: 8, browser: "isolated owned Chrome", viewports: [320, 360, 375, 390, 480, 768, 812, 960, 1024, 1440, 1920] }, null, 2) + "\n");
  console.log(`PASS: ${checks.length} client-preview acceptance checks; no backend traffic.`);
} catch (error) {
  await writeFile(path.join(evidence, "failure.json"), JSON.stringify({ result: "FAIL", step, message: String(error), errors }, null, 2) + "\n");
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (chrome?.pid && chrome.exitCode === null) {
    if (process.platform === "win32") await new Promise(resolve => execFile("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
    else chrome.kill("SIGTERM");
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
