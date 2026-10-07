import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { readFile, stat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve("out/client-preview");
const evidence = path.resolve("reports/client-preview");
const runtime = path.resolve(".test-runtime");
await mkdir(runtime, { recursive: true }); await mkdir(evidence, { recursive: true });
const profile = await mkdtemp(path.join(runtime, "preview-browser-"));
const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
const requests = []; const errors = []; const checks = [];
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpeg": "image/jpeg", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  requests.push({ pathname, method: req.method });
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
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
  step = "home and keyboard";
  await page.goto(base); await page.getByRole("heading", { name: /Your night/ }).waitFor();
  await page.getByRole("heading", { name: "Silent Rave — Owerri" }).waitFor();
  await page.getByAltText("Silent Rave — Owerri poster").evaluate(image => image.decode());
  await page.keyboard.press("Tab"); assert.equal(await page.locator(":focus").textContent(), "Skip to content");
  checks.push("Keyboard skip link and loaded first-party poster");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await widthCheck("375px home without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-home.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await widthCheck("1440px home without overflow");
  await page.screenshot({ path: path.join(evidence, "desktop-home.png"), fullPage: true });
  step = "ticket selection and persistence";
  await page.getByRole("button", { name: "Buy tickets", exact: true }).first().click();
  await page.getByRole("heading", { name: "Silent Rave — Owerri" }).waitFor();
  await page.getByRole("button", { name: "Add one Early Bird" }).click();
  await page.getByRole("button", { name: "Add one Early Bird" }).click();
  assert.equal(await page.getByLabel("Early Bird quantity").textContent(), "2");
  await page.screenshot({ path: path.join(evidence, "desktop-event.png"), fullPage: true });
  await page.getByRole("button", { name: "Add 2 tickets to cart" }).click();
  await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
  await page.getByLabel("Full name").waitFor();
  assert.equal(await page.getByRole("button", { name: "Reserve tickets & get bank details" }).isDisabled(), true);
  assert.match(await page.locator("main").textContent(), /10,000\.00/);
  await page.setViewportSize({ width: 360, height: 800 }); await widthCheck("360px checkout without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-checkout.png"), fullPage: true });
  await page.getByLabel("Full name").fill("Preview Guest"); await page.getByLabel("Email address", { exact: true }).fill("guest@example.invalid");
  await page.getByLabel("Type email again").fill("guest@example.invalid"); await page.getByLabel("Phone number").fill("+2348000000000");
  await page.locator("form").evaluate(form => form.requestSubmit());
  assert.match(page.url(), /\/checkout/);
  const blocked = await page.evaluate(async () => (await fetch("/api/checkout/initialize", { method: "POST", body: "{}" })).status);
  assert.equal(blocked, 403); checks.push("No reservations or payment submission, including programmatic form submit");
  await page.goto(`${base}/cart/`); await page.getByRole("heading", { name: "Silent Rave — Owerri" }).waitFor();
  assert.match(await page.locator("main").textContent(), /2 × Early Bird/); checks.push("Cart persists through document navigation");
  await page.getByRole("button", { name: "Clear cart" }).click(); await page.getByText("Your cart is empty. Find a night to remember.").waitFor();
  checks.push("Clear cart works");
  step = "events and filtering";
  await page.goto(`${base}/events/`); await page.getByRole("heading", { name: "Silent Rave — Owerri" }).waitFor();
  await widthCheck("360px event listing without overflow");
  await page.getByLabel("City", { exact: true }).fill("Abuja"); await page.getByRole("button", { name: "Show events" }).click();
  await page.getByRole("heading", { name: "No events to show" }).waitFor(); checks.push("Filters and empty state work");
  await page.goto(`${base}/events/?view=month&date=2026-11`);
  await page.getByRole("heading", { name: "November 2026" }).waitFor(); await widthCheck("360px month calendar without overflow");
  await page.getByRole("link", { name: "View events on 2026-11-07" }).click();
  await page.getByRole("heading", { name: "Silent Rave — Owerri" }).waitFor(); checks.push("Month to day calendar navigation works");
  step = "static information and disabled message/recovery forms";
  await page.goto(`${base}/about/`); await page.getByRole("heading", { name: "About Silent Rave" }).waitFor(); await widthCheck("360px About without overflow");
  await page.goto(`${base}/contact/`); await page.getByRole("heading", { name: "Contact", exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Send message" }).isDisabled()); await widthCheck("360px Contact without overflow");
  await page.goto(`${base}/lookup/`); await page.getByRole("heading", { name: "Recover your order link" }).waitFor();
  assert(await page.getByRole("button", { name: "Email my status link" }).isDisabled()); await widthCheck("360px Find Order without overflow");
  checks.push("Contact and recovery forms visibly disabled");
  await page.goto(`${base}/event/silent-rave-owerri/`); await page.getByRole("heading", { name: "Tickets", exact: true }).waitFor(); await widthCheck("360px event detail without overflow");
  await page.screenshot({ path: path.join(evidence, "mobile-event.png"), fullPage: true });
  await page.setViewportSize({ width: 812, height: 375 }); await page.emulateMedia({ reducedMotion: "reduce" }); await widthCheck("Landscape with reduced motion without overflow");
  step = "excluded routes and network isolation";
  const response = await page.goto(`${base}/admin/`); assert.equal(response.status(), 404);
  await page.getByRole("heading", { name: "Page unavailable" }).waitFor();
  assert.equal(requests.filter(request => request.pathname.startsWith("/api/") || request.method === "POST").length, 0);
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  checks.push("No HTTP API calls, POSTs, external requests or JavaScript errors; admin route excluded");
  await writeFile(path.join(evidence, "acceptance.json"), JSON.stringify({ result: "PASS", checks, errors, externalRequests: external.length, apiRequests: 0, pages: 8, browser: "isolated owned Chrome", viewports: [360, 375, 812, 1440] }, null, 2) + "\n");
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
