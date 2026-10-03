import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { freePort } from "./fixture";
import { db } from "../src/lib/db";
import sharp from "sharp";
import QRCode from "qrcode";

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
const results: string[] = [];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  const line = `PASS: ${message}`;
  results.push(line);
  console.log(line);
};
const context = await browser.newContext({
  viewport: { width: 375, height: 812 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(180000);
const errors: string[] = [];
page.on("pageerror", () => errors.push("browser JavaScript error"));
const appPort = new URL(process.env.TEST_BASE_URL!).port;
const adminBase = `http://admin.localhost:${appPort}`,
  staffBase = `http://staff.localhost:${appPort}`;
try {
  const event = await db.event.findUniqueOrThrow({
    where: { slug: "dev-fixture-silent-rave" },
    include: { ticketTiers: true },
  });
  const owner = await context.request.post(adminBase + "/api/auth/login", {
    headers: { origin: adminBase },
    data: {
      email: process.env.OWNER_EMAIL,
      password: process.env.OWNER_PASSWORD,
      intent: "admin",
    },
    timeout: 180000,
  });
  check(owner.ok(), "fixture owner login");
  // Compile sensitive controllers with invalid bodies before UI acceptance;
  // neither request can issue tickets or change a password.
  for (const path of ["/api/admin/orders/issue", "/api/auth/password"]) {
    const warm = await context.request.post(adminBase + path, {
      headers: { origin: adminBase },
      data: {},
      timeout: 180000,
    });
    if (warm.status() !== 400)
      throw new Error("Browser controller warmup failed.");
  }
  await page.goto(adminBase + "/admin/orders");
  await page.getByRole("heading", { name: "Orders", exact: true }).waitFor();
  await page.getByText("Issue CASH / COMP tickets", { exact: true }).click();
  await page
    .getByLabel(/^Event/)
    .last()
    .selectOption(event.id);
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Browser fixture guest list");
  await page
    .getByLabel("Buyer name", { exact: true })
    .fill("Browser fixture guest");
  await page
    .getByLabel("Buyer email", { exact: true })
    .fill("browser-step4@example.test");
  await page
    .getByLabel(/^Source/)
    .last()
    .selectOption("COMP");
  await page.getByLabel(/^Tier/).selectOption(event.ticketTiers[0].id);
  await page
    .getByRole("button", { name: "Issue tickets", exact: true })
    .click();
  await page.getByText(/^Issued SR-/).waitFor();
  check(true, "owner UI issues a COMP order using server inventory");
  const order = await db.order.findFirstOrThrow({
    where: { customerEmail: "browser-step4@example.test" },
    include: { ticketUnits: true },
  });
  check(
    order.totalKobo === 0 &&
      order.ticketUnits.length === 1 &&
      order.status === "APPROVED",
    "COMP order and ticket persisted exactly once",
  );
  const token = order.ticketUnits[0].qrToken;
  // Create receipt evidence only in this owned fixture, then use the actual
  // owner UI for the financial decisions (no direct database transitions).
  const publicBase = `http://localhost:${appPort}`;
  const initialize = await context.request.post(
    publicBase + "/api/checkout/initialize",
    {
      data: {
        event_id: event.id,
        customer_name: "Browser Payment Guest",
        customer_email: "browser-review@example.test",
        customer_phone: "08012345678",
        line_items: [{ tier_id: event.ticketTiers[0].id, quantity: 1 }],
      },
    },
  );
  if (initialize.status() !== 201)
    throw new Error("Browser review fixture initialization failed.");
  const guest = await initialize.json();
  const receipt = await sharp({
    create: { width: 640, height: 480, channels: 3, background: "#ffeebb" },
  })
    .jpeg()
    .toBuffer();
  async function submitReceipt() {
    const response = await context.request.post(
      `${publicBase}/api/orders/${guest.order_code}/proof`,
      {
        headers: { "x-status-token": guest.status_token },
        multipart: {
          proof: {
            name: "fixture-receipt.jpg",
            mimeType: "image/jpeg",
            buffer: receipt,
          },
          transfer_reference: "BROWSER-REVIEW-" + crypto.randomUUID(),
          sender_name: "Browser Fixture Sender",
          client_submission_id: crypto.randomUUID(),
        },
        timeout: 120000,
      },
    );
    if (!response.ok())
      throw new Error("Browser fixture receipt submission failed.");
  }
  await submitReceipt();
  const reviewOrder = await db.order.findUniqueOrThrow({
    where: { orderCode: guest.order_code },
  });
  await page.goto(`${adminBase}/admin/orders/${reviewOrder.id}`);
  await page.getByRole("heading", { name: "Receipt attempt 1" }).waitFor();
  await page
    .getByLabel("Message to buyer")
    .fill("Please send a clearer fixture receipt.");
  await page.getByRole("button", { name: "Reject or dismiss" }).click();
  await page
    .getByText(/NEEDS_RESUBMIT/)
    .first()
    .waitFor();
  check(
    (await db.order.findUniqueOrThrow({ where: { id: reviewOrder.id } }))
      .status === "NEEDS_RESUBMIT",
    "owner UI rejects receipt with a resubmission message",
  );
  await submitReceipt();
  await page.reload();
  await page.getByRole("heading", { name: "Receipt attempt 2" }).waitFor();
  await page.getByLabel("I checked the credit in the bank app").check();
  await page
    .getByRole("button", { name: "Approve payment", exact: true })
    .click();
  await page.getByRole("heading", { name: "Tickets and refunds" }).waitFor();
  check(
    (await db.order.findUniqueOrThrow({ where: { id: reviewOrder.id } }))
      .status === "APPROVED" &&
      (await db.ticketUnit.count({ where: { orderId: reviewOrder.id } })) === 1,
    "owner bank-confirmation UI approves and mints exactly one ticket",
  );
  await page
    .getByRole("button", { name: "Resend tickets to original buyer" })
    .click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  check(
    (await db.emailJob.count({
      where: { orderId: reviewOrder.id, kind: "TICKETS" },
    })) === 2,
    "owner UI resends only to the original purchaser",
  );
  await page
    .getByLabel("Re-enter your password", { exact: true })
    .fill(process.env.OWNER_PASSWORD!);
  page.once("dialog", (dialog: any) => dialog.accept());
  await page
    .getByRole("button", { name: "Record refund", exact: true })
    .click();
  await page
    .getByText(/REFUNDED/)
    .first()
    .waitFor();
  check(
    (await db.order.findUniqueOrThrow({ where: { id: reviewOrder.id } }))
      .status === "REFUNDED" &&
      (await db.ticketUnit.count({
        where: { orderId: reviewOrder.id, voidedAt: { not: null } },
      })) === 1,
    "owner UI password-confirmed refund voids tickets without moving money",
  );
  const tier = event.ticketTiers[0];
  const issueMore = async () => {
    const response = await context.request.post(
      adminBase + "/api/admin/orders/issue",
      {
        headers: { origin: adminBase },
        data: {
          client_request_id: crypto.randomUUID(),
          event_id: event.id,
          source: "CASH",
          reason: "Browser online ticket",
          customer_name: "Online Guest",
          customer_email: "browser-online@example.test",
          line_items: [{ tier_id: tier.id, quantity: 1 }],
        },
        timeout: 120000,
      },
    );
    if (!response.ok()) throw new Error("Fixture additional issue failed");
    const result = await response.json();
    return db.ticketUnit.findFirstOrThrow({
      where: { orderId: result.order_id },
    });
  };
  const onlineTicket = await issueMore();
  await page.goto(adminBase + "/admin/events");
  await page
    .getByRole("heading", { name: "Events & tiers", exact: true })
    .waitFor();
  await page
    .getByText(/sold \/.*reserved/)
    .first()
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "reports/step4-desktop-owner.png",
    fullPage: true,
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "desktop owner dashboard has no horizontal overflow",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile owner dashboard has no horizontal overflow",
  );
  await page.screenshot({
    path: "reports/step4-mobile-owner.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  check(
    await page
      .getByRole("link", { name: "Skip to owner workspace" })
      .evaluate((el: HTMLElement) => el === document.activeElement),
    "owner workspace has a keyboard skip link",
  );
  await page.goto(adminBase + "/admin/staff");
  await page.getByRole("button", { name: "Create staff" }).click();
  await page.getByLabel("Staff name").fill("Browser Door Staff");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-staff-step4@example.test");
  await page.getByLabel("Temporary password").fill("temporary-browser-fixture");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByText("browser-staff-step4@example.test", { exact: false })
    .first()
    .waitFor();
  check(true, "owner invites staff through the UI");
  await page.goto(staffBase + "/staff/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("browser-staff-step4@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("temporary-browser-fixture");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("heading", { name: "Set your own password" }).waitFor();
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Current temporary password")
    .fill("temporary-browser-fixture");
  await page
    .getByLabel("New password", { exact: true })
    .fill("new-browser-fixture-password");
  const passwordResponse = page.waitForResponse(
    (response: any) =>
      new URL(response.url()).pathname === "/api/auth/password" &&
      response.request().method() === "POST",
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "Save new password" }).click();
  check(
    (await passwordResponse).status() === 200,
    "staff password replacement commits through POST",
  );
  await page.getByRole("link", { name: "Open door scanner" }).click();
  await page.getByLabel("Event", { exact: true }).selectOption(event.id);
  await page.getByRole("button", { name: "Prepare for event" }).click();
  await page
    .getByText("Prepared. The scanner can now work during a network outage.", {
      exact: true,
    })
    .waitFor();
  check(true, "staff first-login password reset and online event preparation");
  await page
    .locator("#manual-form")
    .evaluate(
      (f: HTMLElement) => ((f.parentElement as HTMLDetailsElement).open = true),
    );
  await page.getByLabel("Ticket QR token").fill(onlineTicket.qrToken);
  await page.getByRole("button", { name: "Check ticket", exact: true }).click();
  await page
    .locator("#result")
    .filter({ hasText: /^VALID/ })
    .waitFor();
  check(
    (await db.ticketUnit.findUniqueOrThrow({ where: { id: onlineTicket.id } }))
      .checkInStatus === "CHECKED_IN",
    "online scan immediately commits server check-in",
  );
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "Check in guests" }).waitFor();
  check(true, "prepared PWA shell reloads without internet");
  const staleTab = await context.newPage();
  await staleTab.goto(staffBase + "/scanner.html");
  await staleTab
    .locator("#status")
    .filter({ hasText: "0 pending scans" })
    .waitFor();
  await page
    .locator("#manual-form")
    .evaluate(
      (f: HTMLElement) => ((f.parentElement as HTMLDetailsElement).open = true),
    );
  await page.getByLabel("Ticket QR token").fill(token);
  await page.getByLabel("Or choose a QR image").setInputFiles({
    name: "fixture-ticket.png",
    mimeType: "image/png",
    buffer: await QRCode.toBuffer(token, {
      width: 500,
      margin: 4,
      errorCorrectionLevel: "Q",
    }),
  });
  await page
    .locator("#result")
    .filter({ hasText: /OFFLINE.*VALID/ })
    .waitFor();
  await page
    .locator("#status")
    .filter({ hasText: "1 pending scans" })
    .waitFor();
  check(
    (
      await db.ticketUnit.findUniqueOrThrow({
        where: { id: order.ticketUnits[0].id },
      })
    ).checkInStatus === "NOT_CHECKED_IN",
    "offline admission persists locally before reaching the server",
  );
  await page.getByRole("button", { name: "Check ticket", exact: true }).click();
  await page
    .locator("#result")
    .filter({ hasText: /DUPLICATE/ })
    .waitFor();
  check(true, "same offline phone rejects duplicate QR");
  await page.reload();
  await page
    .locator("#status")
    .filter({ hasText: "1 pending scans" })
    .waitFor();
  check(true, "offline outbox survives reload");
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page
    .locator("#result")
    .filter({ hasText: /Sync or export/ })
    .waitFor();
  check(true, "logout does not silently discard pending scans");
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: "reports/step4-mobile-scanner.png",
    fullPage: true,
  });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile scanner has no horizontal overflow",
  );
  await context.route("**/api/staff/check-in/batch", (route: any) =>
    route.abort(),
  );
  await context.setOffline(false);
  await staleTab.getByRole("button", { name: "Log out", exact: true }).click();
  await staleTab
    .locator("#result")
    .filter({ hasText: /Sync or export/ })
    .waitFor();
  check(
    true,
    "stale second tab cannot log out and erase another tab's pending scans",
  );
  await staleTab.close();
  await context.unroute("**/api/staff/check-in/batch");
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await page
    .locator("#status")
    .filter({ hasText: "0 pending scans" })
    .waitFor();
  check(
    (
      await db.ticketUnit.findUniqueOrThrow({
        where: { id: order.ticketUnits[0].id },
      })
    ).checkInStatus === "CHECKED_IN",
    "reconnection sync commits queued admission and clears outbox",
  );
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  check(
    (await db.checkInScan.count({
      where: { ticketId: order.ticketUnits[0].id },
    })) === 1,
    "repeat sync does not duplicate scan ledger",
  );
  await page.getByLabel("Search holder name").fill("Nobody");
  check(
    (await page.locator("#attendees li").count()) === 0,
    "prepared attendee search works locally",
  );
  await page.setViewportSize({ width: 812, height: 375 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "landscape reduced-motion scanner has no overflow",
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "24px"));
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "large text scanner has no overflow",
  );
  const denied = await context.request.get(staffBase + "/api/admin/orders");
  check(denied.status() === 403, "staff browser cannot read owner orders");
  check(errors.length === 0, "no browser JavaScript errors");
} catch (error) {
  await page
    .screenshot({ path: "reports/step4-browser-failed.png", fullPage: true })
    .catch(() => {});
  console.log("FAILED: " + (error as Error).message);
  results.push("FAILED: " + (error as Error).message);
  process.exitCode = 1;
} finally {
  try {
    await browser.close();
  } finally {
    await stopChrome();
  }
  await db.$disconnect();
  await writeFile(
    "reports/step4-browser-output.txt",
    results.join("\n") + "\n",
  );
}
