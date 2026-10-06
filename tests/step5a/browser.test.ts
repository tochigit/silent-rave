import { test, expect } from "bun:test";
import { spawn, execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { freePort } from "../../scripts/fixture";
import { db } from "@/lib/db";
import { deriveStatusToken } from "@/lib/orders/status-token";
import { orderFixture } from "../phase4/fixtures";
import { login } from "../phase3b/helpers";
import { IMAGE_FILE_BYTES, MULTIPART_BYTES } from "@/lib/uploads/limits";

// Explicit owned browser acceptance; the full regression skip is followed by a dedicated Linux CI run.
test.skipIf(process.env.SILENT_RAVE_BROWSER_STEP5A !== "1")("owned Chrome: real canvas preparation, non-JSON 413/saved retry ID, HEIC fallback, mobile/banner feedback", async () => {
  const modulePath = path.resolve(".test-runtime/browser-check/node_modules/playwright-core/index.mjs");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const port = await freePort(); const profile = path.join(path.dirname(process.env.LOCAL_STORAGE_DIR!), "batch-a-browser-profile");
  await mkdir(profile, { recursive: true });
  const chrome = spawn(process.env.BROWSER_EXECUTABLE ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", "--disable-component-update", "--disable-sync", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore", detached: process.platform !== "win32" });
  let browser: any;
  try {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
      if (Date.now() > deadline || chrome.exitCode !== null) throw new Error("Owned Chrome readiness failed.");
      await Bun.sleep(250);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage(); page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(120_000);
    const errors: string[] = []; page.on("pageerror", () => errors.push("PAGE_ERROR"));
    const f = await orderFixture(1, false); await db.paymentProof.deleteMany({ where: { orderId: f.order.id } });
    f.order = await db.order.update({ where: { id: f.order.id }, data: { status: "AWAITING_PAYMENT", proofAttempts: 0, holdExpiresAt: new Date(Date.now() + 3600_000) } });
    const base = process.env.TEST_BASE_URL!;
    await page.goto(`${base}/order/${f.order.orderCode}?t=${deriveStatusToken(f.order.id, f.order.statusTokenVersion)}`);
    await page.getByLabel(/^Transfer reference/).fill("BROWSER-BATCH-A"); await page.getByLabel("Sender name", { exact: true }).fill("Fixture Sender");
    // Unsupported HEIC fails locally, before any POST.
    let posts = 0; const attempts: Array<{ id: string; hash: string; size: number }> = [];
    await page.route("**/api/orders/*/proof", async (route: any) => {
      posts++;
      const bytes = route.request().postDataBuffer() as Buffer; const raw = bytes.toString("latin1");
      const id = raw.match(/name="client_submission_id"\r\n\r\n([^\r]+)/)?.[1] ?? "";
      const start = raw.indexOf("\r\n\r\n", raw.indexOf('name="proof"')) + 4;
      const end = raw.indexOf("\r\n--", start);
      attempts.push({ id, hash: createHash("sha256").update(bytes.subarray(start, end)).digest("hex"), size: bytes.length });
      if (posts === 1) return route.fulfill({ status: 413, contentType: "text/html", body: "upstream size limit" });
      await route.continue();
    });
    await page.getByLabel(/^Receipt image/).setInputFiles({ name: "unsupported.heic", mimeType: "image/heic", buffer: Buffer.from("not a supported HEIC image") });
    await page.getByRole("button", { name: "I have paid — submit receipt", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "No image was uploaded" }).waitFor(); expect(posts).toBe(0);
    const image = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#ffeeaa" } }).png().toBuffer();
    await page.getByLabel(/^Receipt image/).setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "Retry receipt upload", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "3 MiB" }).waitFor();
    expect(await page.getByLabel(/^Transfer reference/).inputValue()).toBe("BROWSER-BATCH-A"); expect(await page.getByLabel("Sender name", { exact: true }).inputValue()).toBe("Fixture Sender");
    await page.getByRole("button", { name: "Retry receipt upload", exact: true }).click();
    await page.getByText("Receipt received — review pending", { exact: true }).waitFor();
    expect(posts).toBe(2); expect(attempts[0].id).toBe(attempts[1].id); expect(attempts[0].id).not.toBe("");
    expect(attempts[0].hash).toBe(attempts[1].hash);
    expect(attempts.every(a => a.size <= MULTIPART_BYTES)).toBe(true);
    const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId: f.order.id } });
    expect(proof.sizeBytes).toBeLessThanOrEqual(IMAGE_FILE_BYTES); expect(proof.clientSubmissionId).toBe(attempts[0].id);
    expect(proof.fileSha256).toBe(attempts[1].hash);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir("reports", { recursive: true }); await page.screenshot({ path: "reports/step5a-mobile-receipt.png", fullPage: true });
    const owner = await login(process.env.OWNER_EMAIL!, process.env.OWNER_PASSWORD!);
    await context.addCookies(Object.entries(owner.cookies).map(([name, value]) => ({ name, value, url: base, httpOnly: true, sameSite: "Lax" })));
    await page.goto(base + "/admin/events");
    const card = page.locator("article.op-card").filter({ has: page.getByRole("heading", { name: f.event.title, exact: true }) });
    await card.getByLabel("Banner image", { exact: true }).setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: image });
    let bannerPosts = 0;
    await page.route(`**/api/admin/events/${f.event.id}/banner`, async (route: any) => {
      bannerPosts++;
      if (bannerPosts === 1) return route.fulfill({ status: 413, contentType: "text/html", body: "upstream size limit" });
      const headers = { ...route.request().headers(), host: "admin.localhost:3000", origin: "http://admin.localhost:3000" };
      const response = await route.fetch({ headers, timeout: 120_000 });
      await route.fulfill({ response });
    });
    await card.getByRole("button", { name: "Upload banner", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "3 MiB" }).waitFor();
    await card.getByRole("button", { name: "Retry banner upload", exact: true }).click();
    await card.getByRole("status").filter({ hasText: "Banner saved" }).waitFor();
    expect(bannerPosts).toBe(2); expect((await db.event.findUniqueOrThrow({ where: { id: f.event.id } })).bannerImageUrl).toStartWith("/api/banners/");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "reports/step5a-mobile-banner.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    if (chrome.pid && chrome.exitCode === null) {
      if (process.platform === "win32") await new Promise<void>(resolve => execFile("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
      else process.kill(-chrome.pid, "SIGTERM");
    }
  }
}, 300_000);
