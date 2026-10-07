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
const evidence = path.resolve("reports/reference-design");
const runtime = path.resolve(".test-runtime");
await mkdir(runtime, { recursive: true }); await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(runtime, "preview-browser-"));
const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
const requests = []; const errors = []; const checks = [];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
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
    card: getComputedStyle(document.querySelector(".site-main")).backgroundColor,
    width: document.querySelector(".site-main").getBoundingClientRect().width,
    titleSize: getComputedStyle(document.querySelector(".event-title")).fontSize,
    titleTransform: getComputedStyle(document.querySelector(".event-title")).textTransform,
    posterWidth: document.querySelector(".poster-container img").getBoundingClientRect().width,
    ticket: getComputedStyle(document.querySelector(".ticket-card")).backgroundColor,
    accent: getComputedStyle(document.querySelector(".ticket-card")).borderLeftColor,
    calendar: getComputedStyle(document.querySelector(".calendar-btn")).backgroundColor,
  }));
  const { calendar: originalPurple, ...referenceCore } = reference;
  const { calendar: accessiblePurple, ...actualCore } = actual;
  assert.deepEqual(actualCore, referenceCore, "Client-authored desktop width, poster, type and core colors must match the rendered reference");
  const channels = accessiblePurple.match(/\d+/g).map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const purpleContrast = 1.05 / (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] + 0.05);
  assert(purpleContrast >= 4.5, "White calendar labels need accessible text contrast");
  checks.push("Reference purple enhanced to at least 4.5:1 white-label contrast");
  assert.equal(await page.locator(".home-hero, .hero-art, .frequency-ring, .detail-grid").count(), 0);
  const order = await page.evaluate(() => [".event-header", ".poster-container", ".event-description", ".calendar-dropdown", ".tickets-section", ".details-grid", ".reference-event > .details-group"].map(selector => document.querySelector(selector).getBoundingClientRect().top));
  assert(order.every((value, index) => index === 0 || value > order[index - 1]), "Keep the reference's vertical event section order");
  checks.push("Rendered Rave.html/Rave.css comparison: 600px card, full poster, title, colors and section order");
  await page.screenshot({ path: path.join(evidence, "desktop-home.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.keyboard.press("Tab"); assert.equal(await page.locator(":focus").textContent(), "Skip to content");
  checks.push("Keyboard skip link and loaded first-party poster");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await widthCheck("375px home without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-home.png"), fullPage: true });
  for (const width of [320, 360, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await widthCheck(`${width}px home without overflow`); }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByText("Menu", { exact: true }).click(); await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Events", exact: true }).waitFor();
  await page.keyboard.press("Escape"); assert.equal(await page.locator(".site-menu").evaluate(menu => menu.open), false);
  await page.getByText("Add to calendar", { exact: false }).click();
  await page.getByRole("link", { name: "Google Calendar", exact: true }).waitFor(); await widthCheck("320px calendar dropdown without overflow");
  checks.push("Touch and keyboard navigation and reference calendar dropdown work");
  await page.getByText("Add to calendar", { exact: false }).click();
  step = "ticket selection and persistence";
  await page.getByRole("button", { name: "Buy Early Bird Ticket", exact: true }).click();
  await page.getByRole("dialog", { name: "Buy Early Bird Ticket", exact: true }).waitFor();
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
  await page.goto(`${base}/lookup/`); await page.getByRole("heading", { name: "Recover your order link" }).waitFor();
  assert(await page.getByRole("button", { name: "Email my status link" }).isDisabled()); await widthCheck("360px Find Order without overflow");
  checks.push("Contact and recovery forms visibly disabled");
  await page.goto(`${base}/event/nusa-evangel-silent-rave/`); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor(); await widthCheck("360px event detail without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-event.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: path.join(evidence, "desktop-event.png"), fullPage: true });
  await page.setViewportSize({ width: 812, height: 375 }); await page.emulateMedia({ reducedMotion: "reduce" }); await widthCheck("Landscape with reduced motion without overflow");
  assert.equal(await page.locator(".ticker-content").evaluate(ticker => getComputedStyle(ticker).animationName), "none");
  checks.push("Reduced-motion ticker respects the visitor preference");
  step = "excluded routes and network isolation";
  const response = await page.goto(`${base}/admin/`); assert.equal(response.status(), 404);
  await page.getByRole("heading", { name: "Page unavailable" }).waitFor();
  assert.equal(requests.filter(request => request.pathname.startsWith("/api/") || request.method === "POST").length, 0);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  checks.push("No HTTP API calls, POSTs, external requests or JavaScript errors; admin route excluded");
  assert.equal(hash(await readFile(path.join(root, "assets/preview.js"))), build.bundleSha256);
  assert.equal(hash(await readFile(path.join(root, "assets/preview.css"))), build.cssSha256);
  await writeFile(path.join(evidence, "acceptance.json"), JSON.stringify({ result: "PASS", checks, reference, actual, build, errors, externalRequests: external.length, apiRequests: 0, pages: 8, browser: "isolated owned Chrome", viewports: [320, 360, 375, 390, 768, 812, 1440] }, null, 2) + "\n");
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
