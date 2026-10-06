import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { api, login, createStaffUser, OWNER_EMAIL, OWNER_PASSWORD, type Session } from "../phase3b/helpers";
import { createSession, validateSessionToken, extendSessionIfNeeded } from "@/lib/auth/session";
import { privateHeaders } from "@/lib/auth/policy";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { guardApi, ADMIN_API_ROLES, STAFF_API_ROLES } from "@/lib/auth/guards";
let owner: Session, staff: Session, staffId: string;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
function isPrivate(response: Response) {
  for (const [name, value] of Object.entries(privateHeaders)) expect(response.headers.get(name), name).toBe(value);
}
const input = { v: 1, token: "", surface: "admin", method: "GET", originalPathname: "/admin/future.feature", effectivePathname: "/admin/future.feature", publicOrigin: "http://localhost:3000" };
beforeAll(async () => {
  owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
  const email = `runtime-${crypto.randomUUID()}@example.test`;
  staffId = await createStaffUser(email, "fixture-runtime-password", "STAFF");
  staff = await login(email, "fixture-runtime-password");
}, 90_000);
afterAll(() => db.$disconnect());
test("broker rejects credentials before parsing; bounds and validates JSON; decisions disclose no user data", async () => {
  const url = process.env.TEST_BASE_URL + "/api/internal/session-decision";
  const headers = { "content-type": "application/json", "x-proxy-auth": process.env.PROXY_AUTH_SECRET! };
  for (const key of ["", "wrong", "é".repeat(process.env.PROXY_AUTH_SECRET!.length)]) {
    const response = await fetch(url, { method: "POST", headers: { ...headers, "x-proxy-auth": key }, body: "malformed" });
    expect(response.status).toBe(401); isPrivate(response);
  }
  for (const [body, status] of [["malformed", 400], ["x".repeat(8193), 413], [JSON.stringify({ ...input, extra: true }), 400],
    [JSON.stringify({ ...input, publicOrigin: "https://evil.test" }), 400]] as const) {
    const response = await fetch(url, { method: "POST", headers, body }); expect(response.status).toBe(status); isPrivate(response);
  }
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) });
  expect(response.status).toBe(200); isPrivate(response);
  expect(await response.json()).toEqual({ v: 1, deploymentId: "local", decision: "UNAUTHENTICATED" });
});
test("central policy covers future/dotted/encoded/RSC pages and API prefixes, host rewrites and cross-surface attempts", async () => {
  for (const target of ["/admin/future.feature", "/%61dmin/future", "/admin/future?_rsc=fixture"]) {
    const response = await api(target, { headers: { rsc: "1", "next-router-prefetch": "1", "x-forwarded-host": "evil.test" } });
    expect(response.status).toBe(307); expect(new URL(response.headers.get("location")!).pathname).toBe("/admin/login"); isPrivate(response);
  }
  const rewritten = await api("/future.feature", { host: "admin.localhost:3000" });
  expect(rewritten.status).toBe(307); expect(rewritten.headers.get("location")).toBe("http://admin.localhost:3000/login"); isPrivate(rewritten);
  for (const path of ["/api/admin/future.feature", "/api/staff/future.feature"]) { const response = await api(path); expect(response.status).toBe(401); isPrivate(response); }
  const forbidden = await api("/api/admin/events", { cookies: staff.cookies }); expect(forbidden.status).toBe(403); isPrivate(forbidden);
  for (const target of ["/admin/orders", "/api/admin/events"]) {
    const response = await api(target, { host: "staff.localhost:3000", cookies: owner.cookies }); expect(response.status).toBe(403); isPrivate(response);
  }
  const unknown = await api("/api/staff/session", { host: "evil.test", cookies: owner.cookies }); expect(unknown.status).toBe(421); isPrivate(unknown);
  const hidden = await api("/.netlify/functions/___netlify-server-handler", { cookies: owner.cookies }); expect(hidden.status).toBe(404); isPrivate(hidden);
}, 90_000);
test("full Origins reject scheme, port, sibling and forwarded-header spoofing", async () => {
  for (const origin of ["https://localhost:3000", "http://localhost:444", "http://staff.localhost:3000", "http://evil.test"]) {
    const response = await api("/api/auth/login", { host: "localhost:3000", origin, body: {}, headers: { "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": new URL(origin).protocol.slice(0, -1) } });
    expect(response.status).toBe(403); isPrivate(response);
  }
  const admin = await api("/api/admin/orders/issue", { cookies: owner.cookies, host: "admin.localhost:3000", origin: "http://staff.localhost:3000", body: {} });
  expect(admin.status).toBe(403); isPrivate(admin);
}, 90_000);
test("live staff state enforces temporary passwords and deactivation in broker and Node handlers", async () => {
  const direct = () => new NextRequest("http://localhost:3000/api/staff/session", { headers: { cookie: `sr_session=${staff.cookies.sr_session}` } });
  const allowed = await guardApi(direct(), STAFF_API_ROLES); expect(allowed.ok).toBe(true);
  const wrongRole = await guardApi(direct(), ADMIN_API_ROLES); expect(wrongRole.ok).toBe(false);
  if (!wrongRole.ok) { expect(wrongRole.response.status).toBe(403); isPrivate(wrongRole.response); }
  await db.staffUser.update({ where: { id: staffId }, data: { mustChangePassword: true } });
  const nodeTemporary = await guardApi(direct(), STAFF_API_ROLES); expect(nodeTemporary.ok).toBe(false);
  if (!nodeTemporary.ok) expect(nodeTemporary.response.status).toBe(403);
  const temporary = await api("/api/staff/session", { cookies: staff.cookies }); expect(temporary.status).toBe(403); isPrivate(temporary);
  expect((await temporary.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
  const page = await api("/staff/future", { cookies: staff.cookies }); expect(page.status).toBe(307);
  expect(page.headers.get("location")).toBe("http://staff.localhost:3000/staff/password"); isPrivate(page);
  // Password and logout stay reachable; invalid body is rejected without changing it.
  const password = await api("/api/auth/password", { cookies: staff.cookies, host: "staff.localhost:3000", origin: "http://staff.localhost:3000", body: {} }); expect(password.status).toBe(400);
  await db.staffUser.update({ where: { id: staffId }, data: { mustChangePassword: false, isActive: false } });
  const nodeDisabled = await guardApi(direct(), STAFF_API_ROLES); expect(nodeDisabled.ok).toBe(false);
  if (!nodeDisabled.ok) expect(nodeDisabled.response.status).toBe(401);
  const disabled = await api("/api/staff/session", { cookies: staff.cookies }); expect(disabled.status).toBe(401); isPrivate(disabled);
  await db.staffUser.update({ where: { id: staffId }, data: { isActive: true } });
}, 90_000);
test("HTTP sliding renewal preserves opaque token, renews only near expiry, and logout/expiry stay revoked", async () => {
  const session = await createSession(staffId);
  const cookies = { sr_session: session.token };
  const fresh = await api("/api/staff/session", { cookies }); expect(fresh.status).toBe(200); expect(fresh.headers.get("set-cookie")).toBeNull(); isPrivate(fresh);
  await db.$executeRaw`UPDATE sessions SET expires_at = clock_timestamp() + interval '1 hour' WHERE token_hash = ${digest(session.token)}`;
  const near = await api("/api/staff/session", { cookies }); expect(near.status).toBe(200); isPrivate(near);
  const renewed = near.headers.get("set-cookie")!;
  expect(renewed.startsWith(`sr_session=${session.token};`)).toBe(true);
  for (const attribute of ["HttpOnly", "SameSite=lax", "Path=/", "Expires="]) expect(renewed).toContain(attribute);
  expect(renewed).not.toContain("Domain=");
  const row = await db.session.findUniqueOrThrow({ where: { tokenHash: digest(session.token) } });
  expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(11.5 * 3600000);
  const loggedOut = await api("/api/auth/logout", { cookies, host: "localhost:3000", origin: "http://localhost:3000", method: "POST" }); expect(loggedOut.status).toBe(200);
  const revoked = await api("/api/staff/session", { cookies }); expect(revoked.status).toBe(401); expect(revoked.headers.get("set-cookie")).toBeNull(); isPrivate(revoked);
  const expired = await createSession(staffId);
  await db.$executeRaw`UPDATE sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = ${digest(expired.token)}`;
  const denied = await api("/api/staff/session", { cookies: { sr_session: expired.token } }); expect(denied.status).toBe(401); expect(denied.headers.get("set-cookie")).toBeNull(); isPrivate(denied);
}, 90_000);
test("concurrent renewal never shortens expiry; lock-wait expiry, logout and deactivation cannot revive sessions", async () => {
  const session = await createSession(staffId);
  await db.$executeRaw`UPDATE sessions SET expires_at = clock_timestamp() + interval '1 hour' WHERE token_hash = ${digest(session.token)}`;
  const validated = (await validateSessionToken(session.token))!;
  const attempts = await Promise.all(Array.from({ length: 6 }, () => extendSessionIfNeeded(validated.session)));
  expect(attempts.filter(Boolean)).toHaveLength(1);
  const final = await db.session.findUniqueOrThrow({ where: { id: validated.session.id } });
  expect(final.expiresAt.toISOString()).toBe(attempts.find(Boolean)!.toISOString());
  for (const scenario of ["expiry", "logout", "deactivation"] as const) {
    const fresh = await createSession(staffId); const prior = (await validateSessionToken(fresh.token))!;
    let locked!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => locked = resolve), finish = new Promise<void>(resolve => release = resolve);
    const blocker = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM staff_users WHERE id = ${staffId}::uuid FOR UPDATE`;
      if (scenario === "expiry") await tx.$executeRaw`UPDATE sessions SET expires_at = clock_timestamp() + interval '1 second' WHERE id = ${prior.session.id}::uuid`;
      if (scenario === "logout") await tx.session.delete({ where: { id: prior.session.id } });
      if (scenario === "deactivation") await tx.staffUser.update({ where: { id: staffId }, data: { isActive: false } });
      locked(); await finish;
      if (scenario === "expiry") await tx.$queryRaw`SELECT pg_sleep(1.1)::text`;
    }, { timeout: 10_000 });
    await entered;
    const renewal = extendSessionIfNeeded(prior.session); release(); await blocker;
    expect(await renewal).toBeNull(); expect(await validateSessionToken(fresh.token)).toBeNull();
    if (scenario === "deactivation") await db.staffUser.update({ where: { id: staffId }, data: { isActive: true } });
  }
}, 30_000);
