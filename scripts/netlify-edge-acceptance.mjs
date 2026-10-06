// Executed by the adapter's supported Deno CLI, against the generated handlers.
// Platform context and broker replies are synthetic; no hosted requests occur.
const [rootUrl, transferFile] = Deno.args;
const file = path => new URL(path, rootUrl);
const final = JSON.parse(await Deno.readTextFile(file(".netlify/edge-functions-dist/manifest.json")));
const ingressName = "silent-rave-request-context";
const proxyName = "___netlify-edge-handler-node-middleware";
const transfers = [];
let decision = "UNAUTHENTICATED", malformed = false, renewal;
let context;
globalThis.Netlify = { env: { get: name => Deno.env.get(name) }, get context() { return context; } };
const { default: ingress } = await import(file(`.netlify/edge-functions/${ingressName}/index.ts`));
const { default: proxy } = await import(file(`.netlify/edge-functions/${proxyName}/${proxyName}.js`));
const handlers = { [ingressName]: ingress, [proxyName]: proxy };
const key = Deno.env.get("PROXY_AUTH_SECRET");
globalThis.fetch = async (url, options) => {
  check(String(url) === "https://fixture--silent-rave-fixture.netlify.app/api/internal/session-decision", "fixed broker destination");
  check(options.redirect === "error" && options.credentials === "omit" && options.cache === "no-store", "broker fetch controls");
  check(new Headers(options.headers).get("x-proxy-auth") === key, "broker header key");
  const input = JSON.parse(options.body);
  check(Object.keys(input).sort().join(",") === "effectivePathname,method,originalPathname,publicOrigin,surface,token,v", "minimal broker body");
  return malformed ? new Response("<html>unavailable</html>") : Response.json({ v: 1, deploymentId: "fixture", decision, ...(renewal ? { renewExpiresAt: renewal } : {}) });
};
function check(value, label) { if (!value) throw new Error(`Edge acceptance failed: ${label}`); }
function privateResponse(response) {
  for (const [name, value] of Object.entries({ "cache-control": "private, no-store", "cdn-cache-control": "no-store", "netlify-cdn-cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" })) check(response.headers.get(name) === value, `private ${name}`);
  check(!response.headers.has("x-sr-context") && !response.headers.has("x-sr-signature") && !response.headers.has("x-proxy-auth"), "internal headers stay private");
}
async function execute(url, init = {}) {
  const request = new Request(url, init);
  const order = final.routes.filter(route => new RegExp(route.pattern).test(new URL(url).pathname)).map(route => route.function);
  check(order[0] === ingressName && order[1] === proxyName, "final manifest order");
  const trace = [];
  const dispatch = async (current, index) => {
    if (index === order.length) {
      const body = current.body ? await current.text() : "";
      transfers.push({ url: current.url, method: current.method, headers: [...current.headers], body });
      return Response.json({ ok: true });
    }
    const name = order[index]; trace.push(name);
    context = { ip: "203.0.113.7", geo: {}, deploy: { id: "fixture" }, requestId: "fixture-request", site: { id: "fixture", name: "silent-rave-fixture", url: "https://fixture--silent-rave-fixture.netlify.app" },
      waitUntil() {}, next: next => dispatch(next ?? current, index + 1) };
    const result = await handlers[name](current, context);
    return result ?? dispatch(current, index + 1);
  };
  const response = await dispatch(request, 0);
  check(trace[0] === ingressName && trace[1] === proxyName, "actual ingress/proxy execution order");
  privateResponse(response); return response;
}
const root = "https://silent-rave.example.test";
for (const path of ["/admin/future.feature", "/%61dmin/future", "/admin/future?_rsc=fixture"]) {
  const response = await execute(root + path, { headers: { rsc: "1", "next-router-prefetch": "1", "x-sr-role": "OWNER", "x-forwarded-host": "evil.test", "x-sr-context": "forged", "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware", "x-nf-next-middleware": "skip" } });
  check(response.status === 307 && new URL(response.headers.get("location"), root).pathname === "/admin/login", "protected future path");
}
check((await execute(root + "/api/admin/future.feature")).status === 401, "protected future API");
decision = "FORBIDDEN";
check((await execute(root + "/api/admin/events", { headers: { cookie: `sr_session=${"A".repeat(43)}` } })).status === 403, "wrong role denied");
decision = "ALLOW";
const response = await execute("https://admin.silent-rave.example.test/future.feature?nonce=fixture", { method: "POST", headers: { cookie: `sr_session=${"A".repeat(43)}`, "x-sr-role": "OWNER", "x-forwarded-for": "attacker", "content-type": "text/plain" }, body: "synthetic-stream-body" });
check(response.status === 200, "allowed rewrite reaches Node");
check(transfers.at(-1).url === "https://admin.silent-rave.example.test/admin/future.feature?nonce=fixture", "rewrite and query retained");
check(transfers.at(-1).body === "synthetic-stream-body" && !new Headers(transfers.at(-1).headers).has("x-sr-role"), "stream preserved and assertions stripped");
renewal = new Date(Date.now() + 12 * 3600000).toISOString();
const renewed = await execute(root + "/api/staff/session", { headers: { cookie: `sr_session=${"A".repeat(43)}` } });
for (const value of ["HttpOnly", "Secure", "SameSite=lax", "Domain=.silent-rave.example.test", "Path=/"]) check(renewed.headers.get("set-cookie")?.includes(value), `renewal cookie ${value}`);
renewal = undefined;
malformed = true;
check((await execute(root + "/api/staff/session")).status === 503, "malformed broker reply fails closed");
malformed = false;
check((await execute("https://evil.test/admin")).status === 421, "unknown host denied");
check((await execute(root + "/.netlify/functions/___netlify-server-handler")).status === 404, "direct function path denied");
context = { ip: "203.0.113.7", geo: {}, deploy: { id: "fixture" }, next() { throw new Error("Missing ingress cannot reach Node"); } };
const unsigned = await proxy(new Request(root + "/api/admin/events", { headers: { "x-sr-context": "forged", "x-sr-signature": "0".repeat(64), "x-sr-role": "OWNER" } }), context);
check(unsigned.status === 421, "missing/forged ingress denied"); privateResponse(unsigned);
await Deno.writeTextFile(transferFile, JSON.stringify(transfers), { mode: 0o600 });
console.log(JSON.stringify({ generatedEdgeExecution: true, transferCount: transfers.length, streamingBodyPreserved: true, privateResponses: true }));
