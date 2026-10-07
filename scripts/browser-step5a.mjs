import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";

const database = new URL(process.env.TEST_DATABASE_URL);
const app = new URL(process.env.TEST_BASE_URL);
assert(process.env.SILENT_RAVE_ISOLATED_FIXTURE === "1" && process.env.NODE_ENV !== "production" && database.hostname === "127.0.0.1" && database.pathname === "/silentrave_test" && app.hostname === "127.0.0.1" && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL, "Owned fixture only");
const inputPath = path.resolve(process.argv[2]);
assert.equal(path.dirname(inputPath), path.dirname(process.env.LOCAL_STORAGE_DIR));
const input = JSON.parse(await readFile(inputPath, "utf8"));
const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
let step = "launch";
try {
  const { chromium } = await import(pathToFileURL(path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs")).href);
  const port = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(error => error ? reject(error) : resolve(address.port)); }); });
  const profile = path.join(path.dirname(inputPath), "batch-a-browser-profile"); await mkdir(profile, { recursive: true });
  const chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore", detached: process.platform !== "win32" });
  let browser; let launchError;
  chrome.once("error", error => { launchError = error; });
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
      if (launchError || Date.now() > deadline || chrome.exitCode !== null) throw new Error("Owned Chrome readiness failed.");
      await delay(250);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage(); page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000);
    const errors = []; page.on("pageerror", () => errors.push("PAGE_ERROR"));
    const f = input.fixture; const base = process.env.TEST_BASE_URL;
    step = "receipt page";
    await page.goto(`${base}/order/${f.order.orderCode}?t=${input.token}`);
    await page.getByLabel(/^Transfer reference/).fill("BROWSER-BATCH-A"); await page.getByLabel("Sender name", { exact: true }).fill("Fixture Sender");
    let posts = 0; const attempts = [];
    await page.route("**/api/orders/*/proof", async route => {
      posts++;
      const bytes = route.request().postDataBuffer(); const raw = bytes.toString("latin1");
      const id = raw.match(/name="client_submission_id"\r\n\r\n([^\r]+)/)?.[1] ?? "";
      const start = raw.indexOf("\r\n\r\n", raw.indexOf('name="proof"')) + 4; const end = raw.indexOf("\r\n--", start);
      attempts.push({ id, hash: createHash("sha256").update(bytes.subarray(start, end)).digest("hex"), size: bytes.length });
      if (posts === 1) return route.fulfill({ status: 413, contentType: "text/html", body: "upstream size limit" });
      await route.continue();
    });
    step = "HEIC fallback";
    await page.getByLabel(/^Receipt image/).setInputFiles({ name: "unsupported.heic", mimeType: "image/heic", buffer: Buffer.from("not a supported HEIC image") });
    await page.getByRole("button", { name: "I have paid — submit receipt", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "No image was uploaded" }).waitFor(); assert.equal(posts, 0);
    step = "receipt 413/retry";
    const image = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#ffeeaa" } }).png().toBuffer();
    await page.getByLabel(/^Receipt image/).setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Retry receipt upload", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "3 MiB" }).waitFor();
    assert.equal(await page.getByLabel(/^Transfer reference/).inputValue(), "BROWSER-BATCH-A"); assert.equal(await page.getByLabel("Sender name", { exact: true }).inputValue(), "Fixture Sender");
    await page.getByRole("button", { name: "Retry receipt upload", exact: true }).click();
    await page.getByText("Receipt received — review pending", { exact: true }).waitFor();
    assert.equal(posts, 2); assert.equal(attempts[0].id, attempts[1].id); assert.notEqual(attempts[0].id, ""); assert.equal(attempts[0].hash, attempts[1].hash);
    assert(attempts.every(a => a.size <= input.multipartBytes));
    const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId: f.order.id } });
    assert(proof.sizeBytes <= input.imageFileBytes); assert.equal(proof.clientSubmissionId, attempts[0].id); assert.equal(proof.fileSha256, attempts[1].hash);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mkdir("reports", { recursive: true }); await page.screenshot({ path: "reports/step5a-mobile-receipt.png", fullPage: true });
    console.log("PASS: real receipt canvas, HEIC refusal, non-JSON 413, saved fields/bytes/retry ID and mobile width.");
    step = "banner page";
    await context.addCookies(Object.entries(input.owner.cookies).map(([name, value]) => ({ name, value, url: base, httpOnly: true, sameSite: "Lax" })));
    await page.goto(base + "/admin/events");
    const card = page.locator("article.op-card").filter({ has: page.getByRole("heading", { name: f.event.title, exact: true }) });
    await card.getByLabel("Banner image", { exact: true }).setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: image });
    let bannerPosts = 0;
    await page.route(`**/api/admin/events/${f.event.id}/banner`, async route => {
      bannerPosts++;
      if (bannerPosts === 1) return route.fulfill({ status: 413, contentType: "text/html", body: "upstream size limit" });
      const headers = { ...route.request().headers(), host: "admin.localhost:3000", origin: "http://admin.localhost:3000" };
      await route.fulfill({ response: await route.fetch({ headers, timeout: 120_000 }) });
    });
    step = "banner 413/retry";
    await card.getByRole("button", { name: "Upload banner", exact: true }).click(); await card.getByRole("alert").filter({ hasText: "3 MiB" }).waitFor();
    await card.getByRole("button", { name: "Retry banner upload", exact: true }).click(); await card.getByRole("status").filter({ hasText: "Banner saved" }).waitFor();
    assert.equal(bannerPosts, 2); assert((await db.event.findUniqueOrThrow({ where: { id: f.event.id } })).bannerImageUrl.startsWith("/api/banners/"));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
    await page.screenshot({ path: "reports/step5a-mobile-banner.png", fullPage: true });
    console.log("PASS: real banner preparation, 413/saved image/retry, remote pointer, mobile width and no JavaScript errors.");
  } finally {
    await browser?.close();
    if (chrome.pid && chrome.exitCode === null) {
      if (process.platform === "win32") await new Promise(resolve => execFile("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
      else process.kill(-chrome.pid, "SIGTERM");
    }
  }
} catch (error) {
  let message = error.message; for (const secret of [input.token, ...Object.values(input.owner.cookies)]) message = message.replaceAll(secret, "[fixture]");
  console.error(`FAILED owned browser at ${step}: ${message}`); process.exitCode = 1;
} finally { await db.$disconnect(); }
process.exit(process.exitCode ?? 0);
