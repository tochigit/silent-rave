import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = path.resolve(".test-runtime");
await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, "venue-browser-"));
const bundle = path.join(profile, "venue.js");
await new Promise((resolve, reject) => {
  const child = spawn("bun", ["--no-env-file", "build", "tests/step5b/places-harness.tsx", "--target", "browser", "--outfile", bundle], { windowsHide: true, stdio: "inherit" });
  child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("VENUE_BUNDLE_FAILED")));
});
const server = createServer(async (request, response) => {
  response.writeHead(200, { "content-type": request.url === "/venue.js" ? "application/javascript; charset=utf-8" : "text/html; charset=utf-8" });
  response.end(request.url === "/venue.js" ? await readFile(bundle) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{font:16px sans-serif;margin:16px}main{max-width:600px}label{display:block;margin:8px 0}input,button{min-height:44px;max-width:100%}input{display:block;width:100%}button{white-space:normal}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><div id="root"></div><script src="/venue.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
const checks = [], errors = [], external = [];
let browser, chrome;
try {
  // Create and close only this test's profile/process; never use a signed-in profile.
  chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let launchError; chrome.once("error", (error) => { launchError = error; });
  let port;
  const deadline = Date.now() + 30000;
  for (;;) {
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); if (port) break; } catch {}
    if (launchError || chrome.exitCode !== null || Date.now() > deadline) throw new Error("OWNED_CHROME_UNAVAILABLE");
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let mode = "success", requests = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const suggestion = { label: "1 Fixture Road, Lagos, Nigeria", address: "1 Fixture Road, Lagos, Nigeria",
    latitude: 6.43, longitude: 3.42, city: "Lagos", state: "Lagos", country: "Nigeria" };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) { external.push(url.origin); return route.abort(); }
    if (url.pathname !== "/api/admin/places/autocomplete") return route.continue();
    requests++;
    assert.equal(route.request().method(), "POST");
    assert.deepEqual(Object.keys(route.request().postDataJSON()), ["input"]);
    if (mode === "held") await gate;
    if (mode === "network") return route.abort();
    return route.fulfill({ status: mode === "quota" ? 429 : 200, contentType: "application/json",
      body: JSON.stringify(mode === "quota" ? { error: "Address lookup limit reached. You can enter a verified address and coordinates." }
        : { suggestions: mode === "empty" ? [] : [suggestion] }) });
  });
  await page.goto(base);
  assert.equal(await page.evaluate(() => document.characterSet), "UTF-8");
  await page.getByRole("heading", { name: "Venue address acceptance" }).waitFor();
  await page.getByLabel("Find a venue address", { exact: true }).fill("La");
  await page.getByRole("button", { name: "Find address", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "at least 3 characters" }).waitFor();
  assert.equal(requests, 0); checks.push("Short input gives local feedback without a provider request");

  mode = "held";
  await page.getByLabel("Find a venue address", { exact: true }).fill("Lagos venue");
  await page.getByRole("button", { name: "Find address", exact: true }).focus();
  await page.keyboard.press("Enter");
  const loading = page.getByRole("button", { name: "Finding address…", exact: true });
  await loading.waitFor(); assert.equal(await loading.isDisabled(), true);
  await loading.evaluate((button) => button.click());
  release();
  await page.getByRole("button", { name: suggestion.label, exact: true }).waitFor();
  assert.equal(requests, 1); checks.push("Keyboard lookup shows loading and suppresses duplicate clicks");
  await page.getByRole("button", { name: suggestion.label, exact: true }).click();
  await page.getByRole("status").filter({ hasText: "coordinates filled" }).waitFor();
  for (const [name, value] of Object.entries({ address: suggestion.address, latitude: "6.43", longitude: "3.42", city: "Lagos", state: "Lagos", country: "Nigeria", google_place_id: "", google_maps_url: "" }))
    assert.equal(await page.locator(`input[name="${name}"]`).inputValue(), value);
  assert.equal(requests, 1); checks.push("Selection fills every venue field and clears stale Google links without a details call");
  assert.equal(await page.getByRole("link", { name: "Geoapify", exact: true }).count(), 1);
  assert.equal(await page.getByRole("link", { name: "Data attribution", exact: true }).count(), 1);
  checks.push("Provider and data-source attribution remains after selection");
  await page.getByRole("button", { name: "Save venue", exact: true }).click();
  const saved = JSON.parse(await page.locator("#saved-values").textContent());
  assert.equal(saved.address, suggestion.address); assert.equal(saved.latitude, "6.43");
  checks.push("The parent form submits the selected address and coordinates");

  mode = "empty";
  await page.getByRole("button", { name: "Find address", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "No address found" }).waitFor();
  assert.equal(await page.getByRole("button", { name: suggestion.label, exact: true }).count(), 0);
  checks.push("Empty results clear stale suggestions and retain manual entry");
  assert.equal(await page.getByRole("link", { name: "Geoapify", exact: true }).count(), 1);
  mode = "quota";
  await page.getByRole("button", { name: "Find address", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "limit reached" }).waitFor();
  assert.equal(await page.locator('input[name="address"]').inputValue(), suggestion.address);
  assert.equal(await page.getByRole("button", { name: "Find address", exact: true }).isEnabled(), true);
  checks.push("Quota refusal retains saved fields and restores the lookup button");
  mode = "network";
  await page.getByRole("button", { name: "Find address", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "coordinates manually" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Find address", exact: true }).isEnabled(), true);
  checks.push("Network errors give readable fallback feedback and unlock the form");
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  checks.push("The isolated address form fits a 360px viewport");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await mkdir("reports", { recursive: true });
  await page.screenshot({ path: `reports/free-venue-${process.platform}-form.png`, fullPage: true });
  await writeFile(`reports/free-venue-${process.platform}-browser.json`, JSON.stringify({ result: "PASS", checks,
    browser: "owned isolated Chrome", mockedAddressEndpoint: true, externalRequests: 0, errors }, null, 2));
  console.log(`PASS: ${checks.length} rendered venue-address checks.`);
} finally {
  await browser?.close().catch(() => {});
  if (chrome?.pid && chrome.exitCode === null) {
    if (process.platform === "win32") await new Promise((resolve) => execFile("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { windowsHide: true }, resolve));
    else chrome.kill("SIGTERM");
  }
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
