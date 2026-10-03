import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { freePort } from "./fixture";
import { db } from "../src/lib/db";
import sharp from "sharp";

if (
  process.env.SILENT_RAVE_ISOLATED_FIXTURE !== "1" ||
  process.env.NODE_ENV === "production" ||
  new URL(process.env.DATABASE_URL!).hostname !== "127.0.0.1" ||
  new URL(process.env.DATABASE_URL!).pathname !== "/silentrave_test"
)
  throw new Error("Browser checks require the owned disposable fixture.");
// The Browser and Computer Use plugins are unavailable in this session. This
// fallback package lives only in ignored .test-runtime; use installed Chrome.
const modulePath = path.resolve(
  ".test-runtime/browser-check/node_modules/playwright-core/index.mjs",
);
const { chromium } = await import(pathToFileURL(modulePath).href);
async function launchOwnedChrome() {
  const port = await freePort();
  const profile = path.join(
    path.dirname(process.env.LOCAL_STORAGE_DIR!),
    "browser-profile",
  );
  await mkdir(profile, { recursive: true });
  // Bun's Windows debugging pipe did not connect. Use a dedicated loopback CDP
  // port and an owned profile; no existing user browser or session is attached.
  const chrome = spawn(
    process.env.BROWSER_EXECUTABLE ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-extensions",
      "--disable-component-update",
      "--disable-sync",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: "ignore",
    },
  );
  const stopChrome = async () => {
    if (!chrome.pid || chrome.exitCode !== null) return;
    if (process.platform === "win32")
      await new Promise<void>((resolve) =>
        execFile(
          "taskkill",
          ["/PID", String(chrome.pid), "/T", "/F"],
          { windowsHide: true },
          () => resolve(),
        ),
      );
    else process.kill(-chrome.pid, "SIGTERM");
  };
  try {
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      if (chrome.exitCode !== null)
        throw new Error("Owned Chrome exited before readiness.");
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(2000),
        });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await sleep(250);
    }
    if (!ready) throw new Error("Owned Chrome loopback readiness timed out.");
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 30000,
    });
    return { browser, stopChrome };
  } catch (error) {
    await stopChrome();
    throw error;
  }
}
const { browser, stopChrome } = await launchOwnedChrome();
console.log("Owned Chrome connected over loopback CDP.");
const base = "http://localhost:3000";
const results: string[] = [];
const log = (message: string) => {
  results.push(message);
  console.log(message);
};
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
  log(`PASS: ${message}`);
};
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
// First dev route compilation is setup time; interaction assertions stay 30s.
page.setDefaultNavigationTimeout(120000);
const consoleErrors: string[] = [];
// Keep only fixed error categories, never URLs or token-bearing error text.
page.on("pageerror", () => consoleErrors.push("browser page error"));
const event = await db.event.findUniqueOrThrow({
  where: { slug: "dev-fixture-silent-rave" },
  include: { ticketTiers: true },
});
const receipt = path.join(
  process.env.LOCAL_STORAGE_DIR!,
  "browser-receipt.png",
);
await mkdir(path.dirname(receipt), { recursive: true });
await writeFile(
  receipt,
  await sharp({
    create: { width: 1500, height: 1000, channels: 3, background: "#ffeeaa" },
  })
    .png()
    .toBuffer(),
);
async function visible(text: string) {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible" });
}
async function overflow(label: string) {
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    `${label}: no narrow viewport overflow`,
  );
}
async function refresh() {
  await page
    .getByRole("button", { name: "Refresh order status", exact: true })
    .click();
}
async function fresh() {
  const response = await context.request.post(
    `${base}/api/checkout/initialize`,
    {
      data: {
        event_id: event.id,
        customer_name: "Fixture Browser Buyer",
        customer_email: `browser-${crypto.randomUUID()}@example.test`,
        customer_phone: `080${Math.floor(10000000 + Math.random() * 89999999)}`,
        line_items: [{ tier_id: event.ticketTiers[0].id, quantity: 1 }],
      },
      headers: { "x-forwarded-for": crypto.randomUUID() },
    },
  );
  if (response.status() !== 201)
    throw new Error(`Fixture checkout HTTP ${response.status()}`);
  const body = await response.json();
  const f = {
    orderCode: body.order_code as string,
    statusToken: body.status_token as string,
  };
  const order = await db.order.findUniqueOrThrow({
    where: { orderCode: f.orderCode },
  });
  return { ...f, order };
}
let ownerCookie: string | undefined;
async function ownerAction(
  id: string,
  action: string,
  data: Record<string, unknown>,
) {
  if (!ownerCookie) {
    const login = await context.request.post(`${base}/api/auth/login`, {
      headers: { host: "localhost:3000", origin: base },
      data: {
        email: process.env.OWNER_EMAIL,
        password: process.env.OWNER_PASSWORD,
        intent: "admin",
      },
      timeout: 120000,
    });
    ownerCookie = login.headers()["set-cookie"]?.split(";")[0];
    if (login.status() !== 200 || !ownerCookie)
      throw new Error("Fixture OWNER HTTP login failed.");
  }
  const response = await context.request.post(
    `${base}/api/admin/orders/${id}/${action}`,
    {
      headers: {
        host: "admin.localhost:3000",
        origin: "http://admin.localhost:3000",
        cookie: ownerCookie,
      },
      data,
      timeout: 120000,
    },
  );
  check(
    response.status() === 200,
    `fixture OWNER ${action} accepted through authenticated HTTP`,
  );
}
async function sweep() {
  const response = await context.request.post(
    `${base}/api/internal/expire-holds`,
    {
      headers: { "x-cron-secret": process.env.CRON_SECRET! },
      timeout: 120000,
    },
  );
  check(
    response.status() === 200,
    "fixture expiry sweep accepted through guarded HTTP",
  );
}
async function visit(f: Awaited<ReturnType<typeof fresh>>) {
  await page.goto(`${base}/order/${f.orderCode}?t=${f.statusToken}`);
}
async function verifyPolling() {
  let count = 0;
  let fail = false;
  await page.route("**/api/orders/*/status", async (route: any) => {
    count++;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Fixture disconnect" },
      });
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        event_title: `Polling fixture ${count}`,
      },
    });
  });
  await page.clock.install();
  await refresh();
  await visible("Polling fixture 1");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(60000);
  check(count === 1, "polling pauses while hidden (injected browser clock)");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visible("Polling fixture 2");
  check(count === 2, "visibility resumes one immediate poll");
  fail = true;
  await page.clock.runFor(8001);
  await visible("Could not refresh");
  check(
    count === 3,
    "automatic polling surfaces disconnect without losing saved status",
  );
  await page.clock.runFor(15900);
  check(count === 3, "failed poll backs off to sixteen seconds");
  fail = false;
  await page.clock.runFor(101);
  await visible("Polling fixture 4");
  check(
    (await page.getByText("Could not refresh", { exact: false }).count()) === 0,
    "successful poll clears connection error",
  );
  await page.unroute("**/api/orders/*/status");
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: /Your night/ }).waitFor();
  await overflow("mobile home");
  await page.keyboard.press("Tab");
  check(
    await page
      .locator(".skip-link")
      .evaluate((el: Element) => el === document.activeElement),
    "keyboard starts at skip link",
  );
  await page.keyboard.press("Enter");
  check(
    await page
      .locator("#main")
      .evaluate((el: Element) => el === document.activeElement),
    "skip link focuses main content",
  );
  await page
    .getByRole("button", { name: "Buy tickets", exact: true })
    .first()
    .click();
  await page.waitForURL(/\/event\//);
  await visible("Early Bird");
  await overflow("mobile event");
  await page
    .getByRole("button", { name: "Add one Early Bird", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add 1 tickets to cart", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Continue to checkout", exact: true })
    .click();
  await page
    .getByLabel("Full name", { exact: true })
    .fill("Fixture Browser Buyer");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser-checkout@example.test");
  await page
    .getByLabel("Type email again", { exact: true })
    .fill("mismatch@example.test");
  await page.getByLabel(/^Phone number/).fill("+2348012345999");
  await page.getByRole("button", { name: /Reserve tickets/ }).click();
  await visible("Email addresses must match");
  check(
    await page
      .locator("#confirm-email")
      .evaluate((el: Element) => el === document.activeElement),
    "mismatched email focuses confirmation field",
  );
  await page
    .getByLabel("Type email again", { exact: true })
    .fill("browser-checkout@example.test");
  await page.getByRole("button", { name: /Reserve tickets/ }).click();
  await page.waitForURL(/\/order\//);
  await visible("Awaiting your payment");
  await visible("Dev Fixture Bank");
  await overflow("mobile payment");
  const currentUrl = new URL(page.url());
  const code = currentUrl.pathname.split("/").at(-1)!;
  const token = currentUrl.searchParams.get("t")!;
  check(
    await page.evaluate(
      (secret: string) =>
        !Object.values(sessionStorage).some((value) => value.includes(secret)),
      token,
    ),
    "status token is absent from sessionStorage",
  );
  await page.reload();
  await visible("Awaiting your payment");
  check(
    (await page.getByText("0123456789", { exact: true }).count()) === 1,
    "refresh restores the recorded bank details without email",
  );
  await page
    .getByRole("button", { name: "Copy account number", exact: true })
    .click();
  await visible("Copied");
  const attempts: { id: string; imageHash: string }[] = [];
  let fail = true;
  await page.route("**/api/orders/*/proof", async (route: any) => {
    const bytes = route.request().postDataBuffer() as Buffer;
    const raw = bytes.toString("latin1");
    const id =
      raw.match(/name="client_submission_id"\r\n\r\n([^\r]+)/)?.[1] ?? "";
    const start = raw.indexOf("\r\n\r\n", raw.indexOf('name="proof"')) + 4;
    const end = raw.indexOf("\r\n--", start);
    attempts.push({
      id,
      imageHash: createHash("sha256")
        .update(bytes.subarray(start, end))
        .digest("hex"),
    });
    if (fail) {
      fail = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel(/^Receipt image/).setInputFiles(receipt);
  await page.getByLabel(/^Transfer reference/).fill("BROWSER-RETRY-FIXTURE");
  await page.getByLabel("Sender name", { exact: true }).fill("Fixture Sender");
  await page
    .getByRole("button", { name: "I have paid — submit receipt", exact: true })
    .click();
  await visible("Connection lost");
  check(
    (await page.getByLabel(/^Transfer reference/).inputValue()) ===
      "BROWSER-RETRY-FIXTURE",
    "failed upload preserves reference",
  );
  check(
    (await page.getByLabel("Sender name", { exact: true }).inputValue()) ===
      "Fixture Sender",
    "failed upload preserves sender",
  );
  await page
    .getByRole("button", { name: "Retry receipt upload", exact: true })
    .click();
  await visible("Receipt received — review pending");
  check(
    attempts.length === 2 &&
      !!attempts[0].id &&
      attempts[0].id === attempts[1].id &&
      attempts[0].imageHash === attempts[1].imageHash,
    "upload retry uses the same submission ID and compressed image",
  );
  await page.unroute("**/api/orders/*/proof");
  const order = await db.order.findUniqueOrThrow({
    where: { orderCode: code },
  });
  check(
    order.proofAttempts === 1,
    "failed/retried upload created one proof attempt",
  );
  check(
    (await db.ticketUnit.count({ where: { orderId: order.id } })) === 0,
    "receipt submission creates no tickets",
  );
  await ownerAction(order.id, "reject", {
    reason_code: "UNREADABLE",
    message: "Fixture receipt needs another look",
    final: false,
  });
  await refresh();
  await visible("Please resubmit your receipt");
  await visible("3 submissions remaining");
  await page.getByLabel(/^Receipt image/).setInputFiles(receipt);
  await page.getByLabel(/^Transfer reference/).fill("BROWSER-SECOND-FIXTURE");
  await page.getByLabel("Sender name", { exact: true }).fill("Fixture Sender");
  await page
    .getByRole("button", { name: "I have paid — submit receipt", exact: true })
    .click();
  await visible("Receipt received — review pending");
  await ownerAction(order.id, "approve", { confirmed_in_bank: true });
  await refresh();
  await visible("Your tickets are approved");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download ticket 1 PDF", exact: true })
    .click();
  const download = await downloadEvent;
  check(
    !(await download.failure()),
    "approved PDF downloaded through the browser before email",
  );
  await overflow("mobile approved tickets");
  await verifyPolling();
  await ownerAction(order.id, "refund", {
    password: process.env.OWNER_PASSWORD,
    restock: false,
    acknowledge_checked_in: false,
  });
  await refresh();
  await visible("Order refunded — tickets invalid");
  check(
    (await page.getByRole("button", { name: /Download ticket/ }).count()) === 0,
    "refund removes ticket downloads",
  );
  let terminalPolls = 0;
  const trackStatus = (request: any) => {
    if (request.url().endsWith("/status")) terminalPolls++;
  };
  page.on("request", trackStatus);
  await page.clock.runFor(60000);
  page.off("request", trackStatus);
  check(terminalPolls === 0, "refunded terminal state stops automatic polling");
  const expired = await fresh();
  await db.order.update({
    where: { id: expired.order.id },
    data: { holdExpiresAt: new Date(Date.now() - 60000) },
  });
  await sweep();
  await visit(expired);
  await visible("Your ticket reservation has lapsed");
  await visible("If you already paid");
  await page.getByLabel(/^Receipt image/).setInputFiles(receipt);
  await page.getByLabel(/^Transfer reference/).fill("BROWSER-LATE-FIXTURE");
  await page.getByLabel("Sender name", { exact: true }).fill("Fixture Sender");
  await page
    .getByRole("button", { name: "I have paid — submit receipt", exact: true })
    .click();
  await visible("Your receipt is still awaiting review");
  await visible("Your late receipt has been received");
  check(
    (await page
      .getByRole("button", {
        name: "I have paid — submit receipt",
        exact: true,
      })
      .count()) === 0,
    "expired pending proof never requests another payment/upload",
  );
  await ownerAction(expired.order.id, "reject", {
    reason_code: "CAPACITY_GONE",
    message: "Fixture dismissed final",
    final: true,
  });
  await refresh();
  await visible("Order rejected");
  const old = await fresh();
  await db.order.update({
    where: { id: old.order.id },
    data: { holdExpiresAt: new Date(Date.now() - 25 * 3600000) },
  });
  await sweep();
  await visit(old);
  await visible("No more receipts can be submitted");
  await page.goto(`${base}/order/${code}?t=wrong`);
  await visible("Order link unavailable");
  check(
    (await page.getByText("Dev Fixture Bank", { exact: true }).count()) === 0,
    "invalid token reveals no bank or order status",
  );
  await page.goto(`${base}/lookup`);
  await page.getByLabel("Order code", { exact: true }).fill(code);
  await page
    .getByLabel("Checkout email", { exact: true })
    .fill("browser-checkout@example.test");
  await page
    .getByRole("button", { name: "Email my status link", exact: true })
    .click();
  await visible("If those details match an order");
  const matchedText = await page.getByRole("status").innerText();
  await page.getByLabel("Order code", { exact: true }).fill("SR-NOMATCH");
  await page
    .getByRole("button", { name: "Email my status link", exact: true })
    .click();
  await visible("If those details match an order");
  check(
    (await page.getByRole("status").innerText()) === matchedText,
    "lookup UI gives identical generic matching/unmatched message",
  );
  await page.goto(`${base}/events?search=does-not-exist`);
  await visible("No events to show");
  await overflow("mobile empty catalog");
  await page.goto(`${base}/contact`);
  await page.getByLabel("Name", { exact: true }).fill("Fixture Contact");
  await page.getByLabel("Email", { exact: true }).fill("fake@example.test");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Disposable browser contact enquiry.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await visible("Your message has been sent");
  await overflow("mobile contact");
  await page.goto(base);
  await page.screenshot({
    path: "reports/step3-mobile-home.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/event/${event.slug}`);
  await visible("Early Bird");
  await page.screenshot({
    path: "reports/step3-desktop-event.png",
    fullPage: true,
  });
  await overflow("desktop event");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await overflow("landscape reduced motion");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  await overflow("large text mobile");
  check(consoleErrors.length === 0, "no browser JavaScript errors");
  log(
    "Browser verification complete; real Next/Chrome/PostgreSQL, capture-only email.",
  );
} catch (error) {
  const message = (
    error instanceof Error ? error.message : "Unknown browser failure"
  ).replace(/([?&]t=)[^\s"'&]+/g, "$1[redacted]");
  log(`FAILED: ${message}`);
  process.exitCode = 1;
} finally {
  try {
    await browser.close();
  } finally {
    await stopChrome();
  }
  await db.$disconnect();
  await writeFile(
    "reports/step3-browser-output.txt",
    results.join("\n") + "\n",
  );
}
