import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { routePolicy, canonicalPath, sessionCookieOptions, SCANNER_ASSETS } from "../../src/lib/auth/policy";
import { surfaceUrl, canonicalPageUrl } from "../../src/lib/auth/navigation";
import { originCheck } from "../../src/lib/auth/origin";
import proxy, { config as proxyConfig } from "../../src/proxy";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { publicOrigins, internalOrigin } from "../../src/lib/hosting/config";
import { readTrustedContext } from "../../src/lib/hosting/request-context";
import { readTrustedContextNode } from "../../src/lib/hosting/request-context-node";
import ingress from "../../netlify/ingress/request-context";
import { sessionDecision } from "../../src/lib/auth/proxy-client";
import { sanitizedBuildEnvironment } from "../../scripts/build-netlify-env";
import { integrateIngress } from "../../netlify/plugins/ingress/integration.mjs";
import { auditRoutePolicy } from "../../scripts/route-policy";
const original = { ...process.env };
beforeAll(() => Object.assign(process.env, { HOST_PLATFORM: "netlify", NODE_ENV: "production", ROOT_DOMAIN: "silentrave.space",
  PUBLIC_BASE_URL: "https://silentrave.space", DEPLOY_ID: "fixture", AUTH_INTERNAL_BASE_URL: "https://fixture--silent-rave.netlify.app",
  NETLIFY_INGRESS_SECRET: "synthetic-ingress-secret-123456789012345", PROXY_AUTH_SECRET: "synthetic-broker-secret-123456789012345" }));
afterAll(() => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); });
test("pure policy protects dotted, encoded and host-rewritten future routes", () => {
  for (const path of ["/admin/new.feature", "/%61dmin/future", "/api/admin/new.feature", "/admin/"])
    expect(routePolicy("silentrave.space", path).surface).toBe("admin");
  expect(routePolicy("admin.silentrave.space", "/future").effectivePathname).toBe("/admin/future");
  expect(routePolicy("admin.silentrave.space", "/admin/future").effectivePathname).toBe("/admin/future");
  expect(routePolicy("staff.silentrave.space", "/admin/orders").crossSurface).toBe(true);
  expect(routePolicy("silentrave.space", "/api/administrivia").surface).toBeNull();
  expect(routePolicy("silentrave.space", "/admin/login/leak").login).toBe(false);
  for (const value of ["/admin%2fpayments", "/%2561dmin", "/staff%5cfoo"]) expect(() => canonicalPath(value)).toThrow();
  expect(sessionCookieOptions(new Date()).domain).toBe(".silentrave.space");
  expect(sessionCookieOptions(new Date()).secure).toBe(true);
});
test("every scanner shell asset retains its public staff path; lookalikes stay protected", () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);
  for (const asset of SCANNER_ASSETS) {
    const policy = routePolicy("staff.silentrave.space", asset);
    expect(policy.effectivePathname).toBe(asset);
    expect(policy.surface).toBeNull();
    expect(matcher.test(asset)).toBe(asset === "/scanner.html");
  }
  for (const path of ["/scanner.css.map", "/scanner.webmanifest/private", "/staff/scanner.css", "/api/staff/scanner.js"]) {
    expect(routePolicy("staff.silentrave.space", path).surface).toBe("staff");
    expect(matcher.test(path)).toBe(true);
  }
});
test("hosted auth destinations use the correct origin and local fixtures retain direct paths", () => {
  expect(surfaceUrl("admin", "/admin")).toBe("https://admin.silentrave.space/admin");
  expect(surfaceUrl("staff", "/staff/password")).toBe("https://staff.silentrave.space/staff/password");
  expect(surfaceUrl("staff", "/staff")).toBe("https://staff.silentrave.space/staff");
  expect(() => surfaceUrl("admin", "/staff")).toThrow();
  expect(() => surfaceUrl("admin", "//evil.test")).toThrow();
  const local = { HOST_PLATFORM: "local", NODE_ENV: "test", ROOT_DOMAIN: "localhost" };
  expect(surfaceUrl("admin", "/admin", local)).toBe("/admin");
  expect(canonicalPageUrl("localhost", "/admin", "", "GET", local)).toBeNull();
});
test("root operations and scanner pages canonicalize without changing API origins", () => {
  expect(canonicalPageUrl("silentrave.space", "/admin/payment-accounts", "?page=2", "GET")?.href)
    .toBe("https://admin.silentrave.space/admin/payment-accounts?page=2");
  expect(canonicalPageUrl("silentrave.space", "/staff/password", "", "HEAD")?.href)
    .toBe("https://staff.silentrave.space/staff/password");
  expect(canonicalPageUrl("silentrave.space", "/scanner.html", "", "GET")?.href)
    .toBe("https://staff.silentrave.space/scanner.html");
  for (const [host, path, method] of [
    ["staff.silentrave.space", "/scanner.html", "GET"], ["evil.test", "/admin", "GET"],
    ["silentrave.space", "/api/admin/payment-accounts", "POST"], ["silentrave.space", "/admin", "POST"],
  ]) expect(canonicalPageUrl(host, path, "", method)).toBeNull();
});
function signedRequest(url: string, method = "GET", origin?: string, cookie?: string) {
  const target = new URL(url);
  const raw = JSON.stringify({ v: 1, hostname: target.hostname, origin: target.origin, clientIp: "203.0.113.7",
    method, originalPathname: target.pathname, deploymentId: "fixture", issuedAt: Date.now() });
  const headers = new Headers({ "x-sr-context": raw,
    "x-sr-signature": createHmac("sha256", process.env.NETLIFY_INGRESS_SECRET!).update(raw).digest("hex") });
  if (origin) headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(url, { method, headers });
}
test("owner navigation satisfies the bank origin check without relaxing cross-site rejection", () => {
  const origin = new URL(surfaceUrl("admin", "/admin")).origin;
  const bank = `${origin}/api/admin/payment-accounts`;
  expect(originCheck(signedRequest(bank, "POST", origin), "admin").ok).toBe(true);
  for (const wrong of ["https://silentrave.space", "https://staff.silentrave.space", "https://evil.test"]) {
    expect(originCheck(signedRequest(bank, "POST", wrong), "admin").ok).toBe(false);
  }
  expect(originCheck(signedRequest(bank, "POST"), "admin").ok).toBe(false);
});
test("empty sessions and canonical redirects do not wait on the broker", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error("Broker should not be contacted"); }) as unknown as typeof fetch;
  try {
    const page = await proxy(signedRequest("https://staff.silentrave.space/staff"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://staff.silentrave.space/login");
    const api = await proxy(signedRequest("https://admin.silentrave.space/api/admin/payment-accounts", "POST"));
    expect(api.status).toBe(401);
    const canonical = await proxy(signedRequest("https://silentrave.space/admin/payment-accounts?page=2"));
    expect(canonical.headers.get("location")).toBe("https://admin.silentrave.space/admin/payment-accounts?page=2");
    for (const response of [page, api, canonical]) expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toBe(0);
    const hasToken = await proxy(signedRequest("https://admin.silentrave.space/api/admin/events", "GET", undefined, `sr_session=${"A".repeat(43)}`));
    expect(hasToken.status).toBe(503);
    expect(calls).toBe(1);
  } finally { globalThis.fetch = previous; }
});
test("hosting configuration binds full origins and the immutable same-deploy broker", () => {
  expect(publicOrigins()).toEqual(["https://silentrave.space", "https://admin.silentrave.space", "https://staff.silentrave.space"]);
  for (const base of ["http://silentrave.space", "https://silentrave.space:444", "https://evil.test", "https://silentrave.space/path"])
    expect(() => publicOrigins({ ...process.env, PUBLIC_BASE_URL: base })).toThrow();
  for (const base of ["https://silent-rave.netlify.app", "https://other--silent-rave.netlify.app", "http://127.0.0.1:3000"])
    expect(() => internalOrigin({ ...process.env, AUTH_INTERNAL_BASE_URL: base })).toThrow();
});
test("ingress strips client assertions, preserves streaming body, and both verifiers authenticate the resulting context", async () => {
  Object.assign(globalThis, { Netlify: { env: { get: (key: string) => process.env[key] } } });
  const request = new Request("https://admin.silentrave.space/api/admin/orders?private=value", { method: "POST", body: "synthetic-body",
    headers: { "x-sr-context": "forged", "x-sr-role": "OWNER", "x-forwarded-for": "attacker", "x-forwarded-host": "evil.test" } });
  let signed: Request | undefined;
  await ingress(request, { ip: "203.0.113.7", deploy: { id: "fixture" }, next: async next => { signed = next; return new Response("ok"); } });
  expect(request.bodyUsed).toBe(false);
  expect(signed!.headers.has("x-sr-role")).toBe(false);
  const verified = await readTrustedContext(signed!);
  expect(verified.clientIp).toBe("203.0.113.7");
  expect(verified.origin).toBe("https://admin.silentrave.space");
  expect(readTrustedContextNode(signed!)).toEqual(verified);
  expect(await signed!.text()).toBe("synthetic-body");
  const tampered = new Headers(signed!.headers); tampered.set("x-sr-context", tampered.get("x-sr-context")!.replace("203.0.113.7", "203.0.113.8"));
  expect(() => readTrustedContextNode(new Request(signed!.url, { method: "POST", headers: tampered }))).toThrow();
  await expect(readTrustedContext(new Request("https://admin.silentrave.space/api/admin/other", { method: "POST", headers: signed!.headers }))).rejects.toThrow();
  expect(() => readTrustedContextNode(new Request(signed!.url, { headers: signed!.headers }))).toThrow();
  await expect(readTrustedContext(new Request(signed!.url))).rejects.toThrow();
  const foreign = { ...process.env, DEPLOY_ID: "other" };
  expect(() => readTrustedContextNode(new Request(signed!.url, { method: "POST", headers: signed!.headers }), foreign)).toThrow();
  delete (globalThis as any).Netlify;
});
test("broker transport uses a fixed target and rejects malformed, redirected, oversized or alternate-deploy replies", async () => {
  const input = { v: 1 as const, token: "", surface: "admin" as const, method: "GET", originalPathname: "/admin", effectivePathname: "/admin", publicOrigin: "https://silentrave.space" };
  const valid = { v: 1, deploymentId: "fixture", decision: "ALLOW" };
  const send = (async (url, init) => {
    expect(url).toBe("https://fixture--silent-rave.netlify.app/api/internal/session-decision");
    expect(init!.redirect).toBe("error"); expect(init!.cache).toBe("no-store"); expect(init!.credentials).toBe("omit");
    expect(new Headers(init!.headers).has("cookie")).toBe(false);
    return Response.json(valid);
  }) as typeof fetch;
  expect((await sessionDecision(input, send)).decision).toBe("ALLOW");
  for (const response of [Response.json({ ...valid, decision: "UNKNOWN" }), Response.json({ ...valid, deploymentId: "other" }),
    Response.json({ ...valid, token: "leak" }), new Response("<html>"), new Response("redirect", { status: 302 }),
    Response.json({ ...valid, padding: "x".repeat(4096) })]) {
    await expect(sessionDecision(input, (async () => response) as unknown as typeof fetch)).rejects.toThrow();
  }
});
test("build environment removes current and future secrets/fixtures while keeping the unreachable build-only database", () => {
  const result = sanitizedBuildEnvironment({ PATH: "safe", DATABASE_URL: "hosted", DIRECT_URL: "hosted", OWNER_PASSWORD: "private",
    SUPABASE_SERVICE_ROLE_KEY: "private", FUTURE_PROVIDER_KEY: "private", PROXY_AUTH_SECRET: "private", SILENT_RAVE_ISOLATED_FIXTURE: "1" });
  expect(Object.keys(result).sort()).toEqual(["DATABASE_URL", "DIRECT_URL", "NEXT_TELEMETRY_DISABLED", "PATH"]);
  expect(new URL(result.DATABASE_URL).port).toBe("1"); expect(result.DATABASE_URL).toBe(result.DIRECT_URL);
});
test("broker enforces its eight-second total deadline even when a fetch implementation never settles", async () => {
  const input = { v: 1 as const, token: "", surface: "admin" as const, method: "GET", originalPathname: "/admin", effectivePathname: "/admin", publicOrigin: "https://silentrave.space" };
  const started = Date.now();
  await expect(sessionDecision(input, (() => new Promise<Response>(() => {})) as unknown as typeof fetch)).rejects.toThrow("deadline");
  expect(Date.now() - started).toBeGreaterThanOrEqual(7900);
  expect(Date.now() - started).toBeLessThan(10_000);
}, 12_000);
test("a future API method or protected page without its independent guard fails coverage", () => {
  const guarded = 'async function handle(request) { const guard = await guardApi(request, ADMIN_API_ROLES); if (!guard.ok) return guard.response; } export const GET = handle;';
  expect(auditRoutePolicy([{ file: "src/app/api/admin/future/route.ts", source: guarded }])).toEqual([]);
  expect(auditRoutePolicy([{ file: "src/app/api/admin/future/route.ts", source: guarded + ' export async function POST() { return Response.json({secret:true}); }' }])).toHaveLength(1);
  expect(auditRoutePolicy([{ file: "src/app/(admin)/admin/(protected)/future/page.tsx", source: 'export default function Page() { return null; }' }])).toHaveLength(1);
});
test("build integration is ordered, idempotent and rejects unknown adapter manifests", async () => {
  await mkdir(".test-runtime", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-runtime/ingress-test-"));
  const dir = path.join(root, ".netlify/edge-functions"); await mkdir(dir, { recursive: true });
  const file = path.join(dir, "manifest.json");
  const next = { function: "___netlify-edge-handler-node-middleware", generator: "@netlify/plugin-nextjs@5.16.2", pattern: "^/.*$" };
  const cjsDir = path.join(dir, next.function, "edge-runtime/lib"); await mkdir(cjsDir, { recursive: true });
  await writeFile(path.join(cjsDir, "cjs.ts"), await readFile("node_modules/@netlify/plugin-nextjs/edge-runtime/lib/cjs.ts", "utf8"));
  const handlerRoot = path.join(dir, next.function);
  await mkdir(path.join(handlerRoot, "edge-runtime/shim"), { recursive: true });
  await mkdir(path.join(handlerRoot, "server"), { recursive: true });
  const shim = await readFile("node_modules/@netlify/plugin-nextjs/edge-runtime/shim/node.js", "utf8");
  await writeFile(path.join(handlerRoot, "edge-runtime/shim/node.js"), shim);
  await writeFile(path.join(handlerRoot, "server/node-middleware.js"), shim);
  await writeFile(file, JSON.stringify({ version: 1, functions: [next] }));
  const first = await integrateIngress(root); const second = await integrateIngress(root);
  expect(second).toEqual(first);
  const manifest = JSON.parse(await readFile(file, "utf8")); expect(manifest.functions.map((f: any) => f.function)).toEqual(["silent-rave-request-context", next.function]);
  await writeFile(file, JSON.stringify({ version: 1, functions: [{ ...next, generator: "uninspected" }] }));
  await expect(integrateIngress(root)).rejects.toThrow();
}, 30_000);
