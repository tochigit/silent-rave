import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  api,
  check,
  checkEqual,
  createStaffUser,
  createTestTier,
  initializeOrder,
  login,
  makeDb,
  submitProof,
  type Session,
} from "./helpers";
import { signStoragePath } from "@/lib/storage/local";
import { fileURLToPath } from "node:url";
import "./load-env";

// ─────────────────────────────────────────────────────────────────────────────
// Authorization & transport security:
//   • STAFF and anonymous against EVERY admin route (06: server-side role
//     check on every request; hiding UI is irrelevant)
//   • wrong/missing status_token on order routes
//   • signed proof-image URL expiry + session requirement
//   • bad/missing Origin on every state-changing admin/staff/auth route (06)
//   • Origin checks are STRICT BY DEFAULT (ALLOW_DEV_ORIGIN unset — close-out
//     fix A2): the suite server runs without the flag, so strictness is
//     proven end-to-end on real HTTP; the boot-refusal is proven by executing
//     the same startup guard instrumentation runs, in a subprocess.
// IP buckets: this file uses 10.50.x.x.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_HOST = "admin.localhost:3000";
const ADMIN_ORIGIN = "http://admin.localhost:3000";

const db = makeDb();
let owner: Session;
let staff: Session;
let orderId: string;
let orderCode: string;
let orderToken: string;
let proofStoragePath: string;

beforeAll(async () => {
  owner = await login(process.env.OWNER_EMAIL ?? "owner@silentrave.ng", process.env.OWNER_PASSWORD ?? "silentrave-dev-owner");
  await createStaffUser("staff-authz@test.ng", "staff-password-123", "STAFF");
  staff = await login("staff-authz@test.ng", "staff-password-123");

  // One order with a submitted proof — the target for admin routes.
  const tier = await createTestTier(db, "authz-tier", 10);
  const { status, body } = await initializeOrder({
    tierId: tier.id,
    email: `authz-${Date.now()}@test.ng`,
    phone: "09411112222",
    ip: "10.50.0.1",
  });
  checkEqual(status, 201, "fixture order");
  const order = await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } });
  orderId = order.id;
  orderCode = body!.order_code;
  orderToken = body!.status_token;
  const proofResult = await submitProof({
    orderCode,
    statusToken: orderToken,
    reference: `AUTHZ${Date.now()}`,
    ip: "10.50.0.2",
  });
  checkEqual(proofResult.status, 200, "fixture proof");
  const proof = await db.paymentProof.findFirstOrThrow({ where: { orderId } });
  proofStoragePath = proof.storagePath;
});

afterAll(async () => {
  await db.$disconnect();
});

const ADMIN_GET_ROUTES = [
  "/api/admin/payments",
  "/api/admin/orders/__ID__",
  "/api/admin/payment-accounts",
];

describe("authorization — STAFF and anonymous vs every admin route", () => {
  for (const routeTemplate of ADMIN_GET_ROUTES) {
    for (const [label, buildCookies] of [
      ["anonymous", () => ({} as Record<string, string>)],
      ["STAFF", () => staff.cookies],
      ["OWNER", () => owner.cookies],
    ] as const) {
      test(`${label} GET ${routeTemplate} → ${label === "anonymous" ? "401" : label === "STAFF" ? "403" : "200"}`, async () => {
        // Route resolved INSIDE the test: orderId is set by beforeAll, which
        // runs AFTER describe collection.
        const route = routeTemplate.replace("__ID__", orderId);
        const response = await api(route, { host: "localhost:3000", cookies: buildCookies() });
        const expected = label === "anonymous" ? 401 : label === "STAFF" ? 403 : 200;
        checkEqual(response.status, expected, `${label} on ${route}`);
      });
    }
  }

  test("anonymous POST approve/reject → 401 (proxy gates before the route)", async () => {
    const approve = await api(`/api/admin/orders/${orderId}/approve`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      body: { confirmed_in_bank: true },
    });
    checkEqual(approve.status, 401, "anonymous approve → 401");
    const reject = await api(`/api/admin/orders/${orderId}/reject`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      body: { reason_code: "OTHER", message: "x", final: true },
    });
    checkEqual(reject.status, 401, "anonymous reject → 401");
  });

  test("STAFF POST approve/reject/payment-accounts → 403", async () => {
    const approve = await api(`/api/admin/orders/${orderId}/approve`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: staff.cookies,
      body: { confirmed_in_bank: true },
    });
    checkEqual(approve.status, 403, "staff approve → 403");
    const reject = await api(`/api/admin/orders/${orderId}/reject`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: staff.cookies,
      body: { reason_code: "OTHER", message: "x", final: true },
    });
    checkEqual(reject.status, 403, "staff reject → 403");
    const createAccount = await api("/api/admin/payment-accounts", {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: staff.cookies,
      body: {
        bank_name: "B",
        account_number: "1234567890",
        account_name: "N",
        is_active: false,
        password: "whatever",
      },
    });
    checkEqual(createAccount.status, 403, "staff payment-accounts POST → 403");
  });

  test("the order is untouched by every rejected admin call above", async () => {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    checkEqual(order.status, "PROOF_SUBMITTED", "still PROOF_SUBMITTED");
    const tickets = await db.ticketUnit.count({ where: { orderId } });
    checkEqual(tickets, 0, "no tickets minted");
  });
});

describe("payment-accounts — password re-entry + at-most-one-active + audit", () => {
  test("create + activate requires the OWNER's password; wrong password → 403", async () => {
    const wrongPassword = await api("/api/admin/payment-accounts", {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: owner.cookies,
      body: {
        bank_name: "Guaranteed Trust",
        account_number: "0052345678",
        account_name: "Silent Rave Ltd",
        is_active: true,
        password: "wrong-password",
      },
    });
    checkEqual(wrongPassword.status, 403, "wrong password → 403");

    const accountsAfterWrong = await db.paymentAccount.count();
    const rightPassword = await api("/api/admin/payment-accounts", {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: owner.cookies,
      body: {
        bank_name: "Guaranteed Trust",
        account_number: "0052345678",
        account_name: "Silent Rave Ltd",
        is_active: true,
        password: process.env.OWNER_PASSWORD ?? "silentrave-dev-owner",
      },
    });
    checkEqual(rightPassword.status, 201, "correct password → 201");
    const created = await rightPassword.json();
    checkEqual(created.is_active, true, "created active");

    // At most one active row — the previous active one got deactivated.
    const activeAccounts = await db.paymentAccount.findMany({ where: { isActive: true } });
    checkEqual(activeAccounts.length, 1, "exactly one active account after activating a new one");
    checkEqual(activeAccounts[0].id, created.id, "the NEW account is the active one");

    // BANK_ACCOUNT_CHANGED audit with before/after.
    const audit = await db.auditLogEntry.findFirst({
      where: { action: "BANK_ACCOUNT_CHANGED", entityId: created.id },
    });
    check(audit !== null, "audit entry written");
    const metadata = (audit!.metadata ?? {}) as Record<string, any>;
    checkEqual(metadata.after.account_number, "0052345678", "after value recorded");
    checkEqual(metadata.before, null, "before value recorded (creation)");
    checkEqual(metadata.deactivated_previous, 1, "previous deactivation recorded");
  });

  test("PATCH edits with password re-entry, audits before/after, keeps one active", async () => {
    const active = await db.paymentAccount.findFirstOrThrow({ where: { isActive: true } });
    const beforeAccount = { ...active };
    const response = await api(`/api/admin/payment-accounts/${active.id}`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: owner.cookies,
      method: "PATCH",
      body: {
        account_name: "Silent Rave Events Ltd",
        password: process.env.OWNER_PASSWORD ?? "silentrave-dev-owner",
      },
    });
    checkEqual(response.status, 200, "patch works");
    const audit = await db.auditLogEntry.findFirst({
      where: { action: "BANK_ACCOUNT_CHANGED", entityId: active.id },
      orderBy: { createdAt: "desc" },
    });
    check(audit !== null, "audit entry for the patch");
    const metadata = (audit!.metadata ?? {}) as Record<string, any>;
    checkEqual(metadata.before.account_name, beforeAccount.accountName, "before captured");
    checkEqual(metadata.after.account_name, "Silent Rave Events Ltd", "after captured");

    const activeCount = await db.paymentAccount.count({ where: { isActive: true } });
    checkEqual(activeCount, 1, "still exactly one active account");
  });
});

describe("status tokens on order routes", () => {
  test("status route: missing/wrong token and unknown code all 404 uniformly", async () => {
    const missing = await api(`/api/orders/${orderCode}/status`, { ip: "10.50.1.1" });
    checkEqual(missing.status, 404, "missing token → 404");
    const wrong = await api(`/api/orders/${orderCode}/status?t=not-the-token`, { ip: "10.50.1.1" });
    checkEqual(wrong.status, 404, "wrong token → 404");
    const unknown = await api(`/api/orders/SR-NOPE01/status?t=whatever`, { ip: "10.50.1.1" });
    checkEqual(unknown.status, 404, "unknown code → 404");
    const bodies = new Set([await missing.text(), await wrong.text(), await unknown.text()]);
    checkEqual(bodies.size, 1, "identical error bodies (no oracle)");
  });

  test("proof route: unknown code, wrong token and missing token return the IDENTICAL status code and body, in comparable time (A3)", async () => {
    const { makeJpeg, BASE } = await import("./helpers");
    const image = await makeJpeg(320, 200);

    // Warm the route once (first hit pays Next's route-compile cost and would
    // skew the timing comparison).
    await submitProof({ orderCode: "SR-WARM01", statusToken: "warmup", reference: "WARM", ip: "10.50.1.9" });

    const cases: Array<{ label: string; code: string; token?: string }> = [
      { label: "unknown code", code: "SR-NOPE02", token: "whatever" },
      { label: "wrong token", code: orderCode, token: "totally-wrong-token" },
      { label: "missing token", code: orderCode },
    ];
    const results: Array<{ label: string; status: number; text: string; ms: number }> = [];
    for (const c of cases) {
      const form = new FormData();
      form.append("proof", new Blob([new Uint8Array(image)], { type: "image/jpeg" }), "r.jpg");
      form.append("transfer_reference", `A3-${c.label.replace(/\s+/g, "")}${Date.now()}`);
      form.append("sender_name", "S");
      form.append("client_submission_id", `a3-${c.label.replace(/\s+/g, "")}-${Date.now()}`);
      const headers: Record<string, string> = { "x-sr-test-ip": "10.50.1.2" };
      if (c.token !== undefined) headers["x-status-token"] = c.token; // omitted entirely → missing
      const t0 = performance.now();
      const response = await fetch(`${BASE}/api/orders/${c.code}/proof`, { method: "POST", headers, body: form });
      const ms = performance.now() - t0;
      results.push({ label: c.label, status: response.status, text: await response.text(), ms });
    }

    for (const r of results) checkEqual(r.status, 404, `${r.label} → uniform 404`);
    checkEqual(new Set(results.map((r) => r.text)).size, 1, `byte-identical bodies: ${results.map((r) => r.text).join(" | ")}`);
    check(results[0].text.includes("Order not found"), "the uniform body is the not-found error");

    // Comparable time: all three share the code path (multipart parse → file
    // read → lookup → verify); assert a tight absolute spread and log the
    // measurements.
    const times = results.map((r) => r.ms);
    const spread = Math.max(...times) - Math.min(...times);
    console.log(`A3 timing (ms): ${results.map((r) => `${r.label}=${r.ms.toFixed(1)}`).join(", ")}`);
    check(spread < 250, `comparable time — spread ${spread.toFixed(1)}ms [${times.map((t) => t.toFixed(1)).join(", ")}]`);
  });
});

describe("signed proof-image URLs (owner-only, expiring)", () => {
  test("valid signed URL + OWNER session → 200 image; without session → 401; tampered sig → 403", async () => {
    const { key, exp, sig } = signStoragePath(proofStoragePath, 90);
    const url = `/api/admin/storage/object?key=${encodeURIComponent(key)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;

    const withOwner = await api(url, { host: "localhost:3000", cookies: owner.cookies });
    checkEqual(withOwner.status, 200, "owner + valid signature serves the image");
    checkEqual(withOwner.headers.get("content-type"), "image/jpeg", "served as the re-encoded JPEG");

    const anonymous = await api(url, { host: "localhost:3000" });
    checkEqual(anonymous.status, 401, "no session → 401 (URL alone is useless)");

    const staffAccess = await api(url, { host: "localhost:3000", cookies: staff.cookies });
    checkEqual(staffAccess.status, 403, "STAFF session → 403 (OWNER only)");

    const tamperedSig = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    const tamperedUrl = `/api/admin/storage/object?key=${encodeURIComponent(key)}&exp=${exp}&sig=${encodeURIComponent(tamperedSig)}`;
    const tampered = await api(tamperedUrl, { host: "localhost:3000", cookies: owner.cookies });
    checkEqual(tampered.status, 403, "owner + tampered signature → 403");
  });

  test("expired signed URL → 410 even with an OWNER session; non-proof namespace → 403", async () => {
    const expired = signStoragePath(proofStoragePath, -1);
    const url = `/api/admin/storage/object?key=${encodeURIComponent(expired.key)}&exp=${expired.exp}&sig=${encodeURIComponent(expired.sig)}`;
    const response = await api(url, { host: "localhost:3000", cookies: owner.cookies });
    checkEqual(response.status, 410, "expired URL rejected with 410");

    // A validly-signed path OUTSIDE the proofs namespace is still refused.
    const other = signStoragePath("banners/some-banner.jpg", 90);
    const otherUrl = `/api/admin/storage/object?key=${encodeURIComponent(other.key)}&exp=${other.exp}&sig=${encodeURIComponent(other.sig)}`;
    const otherResponse = await api(otherUrl, { host: "localhost:3000", cookies: owner.cookies });
    checkEqual(otherResponse.status, 403, "non-proof namespace refused");
  });

  test("admin order detail mints short-lived signed URLs but never leaks the raw storage path", async () => {
    const response = await api(`/api/admin/orders/${orderId}`, { host: "localhost:3000", cookies: owner.cookies });
    checkEqual(response.status, 200, "detail works");
    const text = await response.text();
    check(text.includes("/api/admin/storage/object?"), "signed URL present");
    check(!text.includes(proofStoragePath), "raw private storage path NOT in the payload");
    check(!text.includes("storage_path"), "no storage_path field");
  });
});

describe("Origin checks (06) — every state-changing admin/staff/auth route", () => {
  const ORIGIN = "http://localhost:3000";

  test("POST /api/auth/login with bad Origin → 403; missing Origin → 403", async () => {
    const bad = await api("/api/auth/login", {
      host: "localhost:3000",
      origin: "https://evil.example",
      body: { email: "owner@silentrave.ng", password: "whatever" },
    });
    checkEqual(bad.status, 403, "cross-site origin rejected before credentials");
    const missing = await api("/api/auth/login", {
      host: "localhost:3000",
      origin: null,
      body: { email: "owner@silentrave.ng", password: "whatever" },
    });
    checkEqual(missing.status, 403, "missing origin rejected (fail-closed)");
  });

  test("POST approve with bad Origin → 403 and no state change", async () => {
    const before = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const bad = await api(`/api/admin/orders/${orderId}/approve`, {
      host: ADMIN_HOST,
      origin: "https://evil.example",
      cookies: owner.cookies,
      body: { confirmed_in_bank: true },
    });
    checkEqual(bad.status, 403, "approve with evil origin → 403");
    const after = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    checkEqual(after.status, before.status, "no state change");
  });

  test("POST reject with bad Origin → 403", async () => {
    const bad = await api(`/api/admin/orders/${orderId}/reject`, {
      host: ADMIN_HOST,
      origin: "https://evil.example",
      cookies: owner.cookies,
      body: { reason_code: "OTHER", message: "x", final: true },
    });
    checkEqual(bad.status, 403, "reject with evil origin → 403");
  });

  test("POST payment-accounts with bad Origin → 403; PATCH with bad Origin → 403", async () => {
    const badCreate = await api("/api/admin/payment-accounts", {
      host: ADMIN_HOST,
      origin: "https://evil.example",
      cookies: owner.cookies,
      body: { bank_name: "X", account_number: "1111111111", account_name: "Y", password: "z" },
    });
    checkEqual(badCreate.status, 403, "create with evil origin → 403");
    const active = await db.paymentAccount.findFirstOrThrow({ where: { isActive: true } });
    const badPatch = await api(`/api/admin/payment-accounts/${active.id}`, {
      host: ADMIN_HOST,
      origin: "https://evil.example",
      method: "PATCH",
      cookies: owner.cookies,
      body: { account_name: "Hacked", password: process.env.OWNER_PASSWORD ?? "silentrave-dev-owner" },
    });
    checkEqual(badPatch.status, 403, "patch with evil origin → 403");
    const unchanged = await db.paymentAccount.findUniqueOrThrow({ where: { id: active.id } });
    checkEqual(unchanged.accountName, active.accountName, "no mutation happened");
  });

  test("POST logout with bad Origin → 403", async () => {
    const bad = await api("/api/auth/logout", {
      host: "localhost:3000",
      origin: "https://evil.example",
      cookies: owner.cookies,
      body: {},
    });
    checkEqual(bad.status, 403, "logout with evil origin → 403");
  });

  test("same-origin requests still work (regression): login + logout round-trip", async () => {
    const loginResponse = await api("/api/auth/login", {
      host: "localhost:3000",
      origin: ORIGIN,
      body: {
        email: "staff-authz@test.ng",
        password: "staff-password-123",
      },
    });
    checkEqual(loginResponse.status, 200, "same-origin login works");
    const logout = await api("/api/auth/logout", {
      host: "localhost:3000",
      origin: ORIGIN,
      cookies: staff.cookies,
      body: {},
    });
    checkEqual(logout.status, 200, "same-origin logout works");
  });

  test("GET admin routes do NOT require Origin (06 scopes the check to state-changing methods)", async () => {
    const response = await api("/api/admin/payments", { host: "localhost:3000", cookies: owner.cookies, origin: null });
    checkEqual(response.status, 200, "GET without Origin header passes");
  });
});

describe("Origin-check STRICT DEFAULT (A2) — ALLOW_DEV_ORIGIN is unset on this server", () => {
  test("flag UNSET → strict: the ROOT host's Origin is NOT accepted on the admin surface (was the old dev relaxation)", async () => {
    // Dedicated order (approving it must not disturb the shared fixture order
    // that later content tests still assert on).
    const tier = await createTestTier(db, "strict-origin-tier", 5);
    const { status, body } = await initializeOrder({
      tierId: tier.id,
      email: `strict-origin-${Date.now()}@test.ng`,
      phone: "09611112222",
      ip: "10.50.3.1",
    });
    checkEqual(status, 201, "fixture order");
    const strictOrderId = (await db.order.findUniqueOrThrow({ where: { orderCode: body!.order_code } })).id;
    const proofResult = await submitProof({
      orderCode: body!.order_code,
      statusToken: body!.status_token,
      reference: `SO${Date.now()}`,
      ip: "10.50.3.2",
    });
    checkEqual(proofResult.status, 200, "fixture proof");

    // The suite's dev server runs WITHOUT ALLOW_DEV_ORIGIN. Strict 06 rules:
    // the admin surface accepts ONLY Origin http://admin.localhost:3000 —
    // the root host's Origin (the OLD dev relaxation) is rejected.
    const rootOrigin = await api(`/api/admin/orders/${strictOrderId}/approve`, {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      cookies: owner.cookies,
      body: { confirmed_in_bank: true },
    });
    checkEqual(rootOrigin.status, 403, "root-host Origin on an admin route → 403 under the strict default");
    const untouched = await db.order.findUniqueOrThrow({ where: { id: strictOrderId } });
    checkEqual(untouched.status, "PROOF_SUBMITTED", "no state change");

    // …while the surface's OWN origin still passes (same session, same route).
    const adminOrigin = await api(`/api/admin/orders/${strictOrderId}/approve`, {
      host: ADMIN_HOST,
      origin: ADMIN_ORIGIN,
      cookies: owner.cookies,
      body: { confirmed_in_bank: true },
    });
    checkEqual(adminOrigin.status, 200, "admin.localhost Origin accepted (strict allows the surface's own host)");
    const approved = await db.order.findUniqueOrThrow({ where: { id: strictOrderId } });
    checkEqual(approved.status, "APPROVED", "the admin-origin call really worked");
  });
});

describe("Origin boot guard (A2) — the startup assertion instrumentation runs", () => {
  const GUARD_MODULE = fileURLToPath(new URL("../../src/lib/auth/origin-config.ts", import.meta.url));

  /**
   * Runs the exact guard instrumentation.register() calls, in a fresh bun
   * subprocess under the given env. Returns { exitCode, output }.
   */
  async function runBootGuard(env: Record<string, string>): Promise<{ exitCode: number; output: string }> {
    const script = `
const mod = await import(${JSON.stringify(GUARD_MODULE)});
try {
  mod.assertOriginConfigHealthy();
  console.log("STARTED-OK");
} catch (error) {
  console.error("REFUSED: " + error.message);
  process.exit(1);
}`;
    const proc = Bun.spawn(["bun", "-e", script], {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, output: `${stdout}${stderr}` };
  }

  test("ALLOW_DEV_ORIGIN=1 set while NODE_ENV=production → startup REFUSES", async () => {
    const result = await runBootGuard({ NODE_ENV: "production", ALLOW_DEV_ORIGIN: "1" });
    checkEqual(result.exitCode, 1, `guard process exit code 1 (got ${result.exitCode})`);
    check(result.output.includes("REFUSED"), `refusal message emitted: ${result.output.trim()}`);
    check(result.output.includes("ALLOW_DEV_ORIGIN"), "the message names the offending flag");
    check(!result.output.includes("STARTED-OK"), "the server did NOT start");
  });

  test("flag UNSET in production mode → the guard passes (strict, boots normally)", async () => {
    const result = await runBootGuard({ NODE_ENV: "production", ALLOW_DEV_ORIGIN: "" });
    checkEqual(result.exitCode, 0, "guard process exit code 0");
    check(result.output.includes("STARTED-OK"), "boot continues: strict default is a valid configuration");
  });

  test("flag set in DEV mode → the guard passes (the opt-in is legal outside production)", async () => {
    const result = await runBootGuard({ NODE_ENV: "development", ALLOW_DEV_ORIGIN: "1" });
    checkEqual(result.exitCode, 0, "guard process exit code 0");
    check(result.output.includes("STARTED-OK"), "boot continues: dev opt-in allowed");
  });
});

describe("internal expire-holds guard", () => {
  test("missing or wrong CRON secret → 401; correct secret → 200", async () => {
    const missing = await api("/api/internal/expire-holds", { body: {} });
    checkEqual(missing.status, 401, "missing secret → 401");
    const wrong = await api("/api/internal/expire-holds", {
      headers: { "x-cron-secret": "not-the-secret" },
      body: {},
    });
    checkEqual(wrong.status, 401, "wrong secret → 401");
    const correct = await api("/api/internal/expire-holds", {
      headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
      body: {},
    });
    checkEqual(correct.status, 200, "correct secret → 200");
    const body = await correct.json();
    check(typeof body.expired === "number", "expired count returned");
  });
});

describe("order status endpoint content rules (03)", () => {
  test("no PII beyond buyer-entered data; ticket list only when APPROVED; late_proof_received flag", async () => {
    // Our fixture order is PROOF_SUBMITTED — no tickets yet.
    const response = await api(`/api/orders/${orderCode}/status?t=${orderToken}`, { ip: "10.50.2.1" });
    checkEqual(response.status, 200, "status works");
    const body = await response.json();
    checkEqual(body.order_code, orderCode, "code present");
    checkEqual(body.status, "PROOF_SUBMITTED", "status present");
    checkEqual(body.proof_attempts, 1, "attempts present");
    checkEqual(body.max_resubmissions, 3, "max resubmissions present");
    check(!("tickets" in body), "no ticket list before APPROVED");
    check(!("rejection" in body), "no rejection block while not rejected");
    const text = JSON.stringify(body);
    check(!text.toLowerCase().includes("phone"), "no phone echo");
    check(!text.toLowerCase().includes("storage"), "no storage paths");
  });
});
