import { test, expect } from "bun:test";
import { api } from "../phase3b/helpers";
import { NextRequest } from "next/server";
import { guardApi, ADMIN_API_ROLES } from "@/lib/auth/guards";
import { privateHeaders } from "@/lib/auth/policy";
test("database outage fails closed in the central proxy, Node guard and secret-gated broker", async () => {
  const cookie = { sr_session: "A".repeat(43) };
  const response = await api("/api/admin/events", { cookies: cookie }); expect(response.status).toBe(503);
  for (const [name, value] of Object.entries(privateHeaders)) expect(response.headers.get(name)).toBe(value);
  const guard = await guardApi(new NextRequest("http://localhost:3000/api/admin/events", { headers: { cookie: `sr_session=${cookie.sr_session}` } }), ADMIN_API_ROLES);
  expect(guard.ok).toBe(false); if (!guard.ok) expect(guard.response.status).toBe(503);
  const broker = await api("/api/internal/session-decision", { method: "POST", headers: { "x-proxy-auth": process.env.PROXY_AUTH_SECRET! }, body: {
    v: 1, token: cookie.sr_session, surface: "admin", method: "GET", originalPathname: "/admin", effectivePathname: "/admin", publicOrigin: "http://localhost:3000" } });
  expect(broker.status).toBe(503); expect(await broker.json()).toEqual({ error: "Decision service unavailable" });
}, 90_000);
