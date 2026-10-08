import { createServer } from "node:http";
import { createServer as createProbe } from "node:net";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = path.resolve(".test-runtime"); await mkdir(root, { recursive: true });
const profile = await mkdtemp(path.join(root, "polling-browser-"));
const bundle = path.join(profile, "polling.js");
await new Promise((resolve, reject) => {
  const child = spawn("bun", ["--no-env-file", "build", "tests/step5b/polling-harness.tsx", "--target", "browser", "--outfile", bundle], { windowsHide: true, stdio: "inherit" });
  child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("POLLING_BUNDLE_FAILED")));
});
const server = createServer(async (request, response) => {
  const script = request.url === "/polling.js";
  response.writeHead(200, { "content-type": script ? "application/javascript" : "text/html" });
  response.end(script ? await readFile(bundle) : '<!doctype html><html><body><div id="root"></div><script src="/polling.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const port = await new Promise((resolve, reject) => {
  const probe = createProbe(); probe.once("error", reject); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(error => error ? reject(error) : resolve(port)); });
});
const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
const checks = [], errors = [], external = [];
let chrome, browser;
try {
  chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let launchError; chrome.once("error", error => { launchError = error; });
  const deadline = Date.now() + 120000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    if (launchError || chrome.exitCode !== null || Date.now() > deadline) throw new Error("OWNED_CHROME_UNAVAILABLE");
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await browser.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(base); await page.getByRole("heading", { name: "Polling acceptance" }).waitFor();
  const state = () => page.evaluate(() => ({ requests: window.pollingFixture.requests, aborts: window.pollingFixture.aborts, timers: window.pollingFixture.timers() }));
  const advance = ms => page.evaluate(ms => window.pollingFixture.advance(ms), ms);
  assert.equal((await state()).requests, 0); await advance(60000); assert.equal((await state()).requests, 0);
  checks.push("Disabled hook makes no request");
  await page.evaluate(() => window.pollingFixture.setEnabled(true));
  await page.getByText("PROOF_SUBMITTED", { exact: true }).waitFor();
  assert.deepEqual((await state()).timers, [8000]);
  await page.getByRole("button", { name: "Rerender", exact: true }).click(); await advance(0);
  assert.equal((await state()).requests, 1); checks.push("Inline interval and terminal callbacks do not restart polling on rerender");
  await page.evaluate(() => { window.pollingFixture.status = "APPROVED"; }); await advance(8000);
  await page.getByText("APPROVED", { exact: true }).waitFor(); assert.deepEqual((await state()).timers, [60000]);
  checks.push("Active orders poll at 8 seconds and approval switches to 60 seconds");
  await page.evaluate(() => { window.pollingFixture.fail = true; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await advance(0);
  assert.deepEqual((await state()).timers, [60000]);
  checks.push("Failed manual refresh retains the approved 60-second cadence and saved status");
  await page.evaluate(() => { window.pollingFixture.fail = false; });
  await page.evaluate(() => { window.pollingFixture.status = "REFUNDED"; }); await advance(60000);
  await page.getByText("REFUNDED", { exact: true }).waitFor(); assert.deepEqual((await state()).timers, []);
  checks.push("Approved order observes refund and terminal status stops automatic polling");
  const terminalRequests = (await state()).requests;
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await advance(0);
  assert.equal((await state()).requests, terminalRequests + 1); checks.push("Manual refresh still works after terminal status");
  await page.evaluate(() => { window.pollingFixture.status = "EXPIRED"; });
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await advance(0);
  assert.deepEqual((await state()).timers, [8000]); checks.push("Expired reservations continue polling for late-proof transitions");
  await page.evaluate(() => { window.pollingFixture.fail = true; }); await advance(8000);
  assert.deepEqual((await state()).timers, [16000]); await advance(16000); assert.deepEqual((await state()).timers, [32000]);
  checks.push("Failures retain saved data and use bounded exponential backoff");
  const beforeHidden = (await state()).requests;
  await page.evaluate(() => { window.pollingFixture.hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await advance(60000); assert.equal((await state()).requests, beforeHidden);
  await page.evaluate(() => { window.pollingFixture.fail = false; window.pollingFixture.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await advance(0); assert.equal((await state()).requests, beforeHidden + 1); assert.deepEqual((await state()).timers, [8000]);
  checks.push("Hidden pages pause requests; visibility resumes immediately and clears backoff");
  await page.evaluate(() => { window.pollingFixture.hold = true; }); await advance(8000);
  assert.deepEqual((await state()).timers, [30000]);
  await page.evaluate(() => window.pollingFixture.setEnabled(false)); await advance(0);
  assert.equal((await state()).aborts, 1); assert.deepEqual((await state()).timers, []);
  const disabled = (await state()).requests; await advance(60000); assert.equal((await state()).requests, disabled);
  checks.push("Disabling aborts an in-flight request, clears timers and prevents stale-generation updates");
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await mkdir("reports", { recursive: true });
  await writeFile(`reports/step5b-${process.platform}-polling-browser.json`, JSON.stringify({ result: "PASS", checks, browser: "owned isolated Chrome", externalRequests: 0, errors }, null, 2));
  console.log(`PASS: ${checks.length} rendered polling checks.`);
} finally {
  await browser?.close().catch(() => {});
  if (chrome?.pid && chrome.exitCode === null) {
    if (process.platform === "win32") await new Promise(resolve => execFile("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { windowsHide: true }, resolve));
    else chrome.kill("SIGTERM");
  }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
