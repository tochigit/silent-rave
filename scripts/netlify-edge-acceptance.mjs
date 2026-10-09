// Executed by the adapter's supported Deno CLI, against the generated handlers.
// Platform context and broker replies are synthetic; no hosted requests occur.
const [rootUrl, transferFile] = Deno.args;
for (const key of ["DEPLOY_ID", "SR_NETLIFY_DEPLOY_ID", "SR_NETLIFY_SITE_NAME", "AUTH_INTERNAL_BASE_URL"]) {
  if (Deno.env.get(key)) throw new Error("Edge acceptance requires compiled identity without runtime overrides");
}
const file = path => new URL(path, rootUrl);
const final = JSON.parse(await Deno.readTextFile(file(".netlify/edge-functions-dist/manifest.json")));
const ingressName = "silent-rave-request-context";
const proxyName = "___netlify-edge-handler-node-middleware";
// The adapter omits the proxy for these exact public files. Ingress still signs
// their requests. Protected pages, APIs and scanner.html require both handlers.
const staticShell = new Set(["/scanner.js", "/scanner.css", "/scanner-sw.js", "/scanner.webmanifest",
  "/scanner-icon.svg", "/scanner-icon-192.png", "/scanner-icon-512.png"]);
const transfers = [];
let decision = "UNAUTHENTICATED", malformed = false, renewal, brokerCalls = 0;
let context;
globalThis.Netlify = { env: { get: name => Deno.env.get(name) }, get context() { return context; } };
const { default: ingress } = await import(file(`.netlify/edge-functions/${ingressName}/index.ts`));
const { default: proxy } = await import(file(`.netlify/edge-functions/${proxyName}/${proxyName}.js`));
const handlers = { [ingressName]: ingress, [proxyName]: proxy };
const key = Deno.env.get("PROXY_AUTH_SECRET");
globalThis.fetch = async (url, options) => {
  brokerCalls++;
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
async function execute(url, init = {}, expectPrivate = true) {
  const request = new Request(url, init);
  const order = final.routes.filter(route => new RegExp(route.pattern).test(new URL(url).pathname)).map(route => route.function);
  const expectedOrder = staticShell.has(new URL(url).pathname) ? [ingressName] : [ingressName, proxyName];
  check(JSON.stringify(order) === JSON.stringify(expectedOrder), "final manifest order for protected routes and exact public shell");
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
  check(JSON.stringify(trace) === JSON.stringify(expectedOrder), "actual ingress/proxy execution order");
  if (expectPrivate) privateResponse(response); return response;
}
const root = "https://silent-rave.example.test";
for (const path of ["/admin/future.feature", "/%61dmin/future", "/admin/future?_rsc=fixture"]) {
  const response = await execute(root + path, { headers: { rsc: "1", "next-router-prefetch": "1", "x-sr-role": "OWNER", "x-forwarded-host": "evil.test", "x-sr-context": "forged", "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware", "x-nf-next-middleware": "skip" } });
  if (response.status !== 307) {
    // Isolated synthetic requests only; expose the public failure category.
    console.error(JSON.stringify({ check: "protected future path", status: response.status, error: (await response.clone().text()).slice(0, 256) }));
  }
  const destination = new URL(response.headers.get("location"), root);
  check(response.status === 307 && destination.origin === "https://admin.silent-rave.example.test" &&
    destination.pathname === decodeURIComponent(path.split("?")[0]), "root operations canonical destination");
  const protectedPage = await execute(destination.href);
  check(protectedPage.status === 307 && new URL(protectedPage.headers.get("location"), destination).pathname === "/login", "protected future path");
}
check((await execute(root + "/api/admin/future.feature")).status === 401, "protected future API");
check(brokerCalls === 0, "empty sessions reject without a remote broker request");
for (const path of ["/scanner.html", "/scanner.css", "/scanner.webmanifest", "/scanner-icon.svg"]) {
  const response = await execute("https://staff.silent-rave.example.test" + path, {}, false);
  check(response.status === 200 && transfers.at(-1).url === "https://staff.silent-rave.example.test" + path, "staff PWA asset path retained");
}
const scannerRedirect = await execute(root + "/scanner.html");
check(scannerRedirect.status === 307 && scannerRedirect.headers.get("location") === "https://staff.silent-rave.example.test/scanner.html", "scanner canonical staff host");
decision = "FORBIDDEN";
check((await execute(root + "/api/admin/events", { headers: { cookie: `sr_session=${"A".repeat(43)}` } })).status === 403, "wrong role denied");
decision = "ALLOW";
const response = await execute("https://admin.silent-rave.example.test/future.feature?nonce=fixture", { method: "POST", headers: { cookie: `sr_session=${"A".repeat(43)}`, "x-sr-role": "OWNER", "x-forwarded-for": "attacker", "x-nf-debug-logging": "1", "x-next-debug-logging": "1", "content-type": "text/plain" }, body: "synthetic-stream-body" });
check(response.status === 200, "allowed rewrite reaches Node");
check(transfers.at(-1).url === "https://admin.silent-rave.example.test/admin/future.feature?nonce=fixture", "rewrite and query retained");
check(transfers.at(-1).body === "synthetic-stream-body" && !new Headers(transfers.at(-1).headers).has("x-sr-role"), "stream preserved and assertions stripped");
check(!new Headers(transfers.at(-1).headers).has("x-nf-debug-logging") && !new Headers(transfers.at(-1).headers).has("x-next-debug-logging"), "client cannot enable adapter debug logging");
renewal = new Date(Date.now() + 12 * 3600000).toISOString();
const renewed = await execute(root + "/api/staff/session", { headers: { cookie: `sr_session=${"A".repeat(43)}` } });
for (const value of ["HttpOnly", "Secure", "SameSite=lax", "Domain=.silent-rave.example.test", "Path=/"]) check(renewed.headers.get("set-cookie")?.includes(value), `renewal cookie ${value}`);
renewal = undefined;
malformed = true;
check((await execute(root + "/api/staff/session", { headers: { cookie: `sr_session=${"A".repeat(43)}` } })).status === 503, "malformed broker reply fails closed");
malformed = false;
check((await execute("https://evil.test/admin")).status === 421, "unknown host denied");
check((await execute(root + "/.netlify/functions/___netlify-server-handler")).status === 404, "direct function path denied");
context = { ip: "203.0.113.7", geo: {}, deploy: { id: "fixture" }, next() { throw new Error("Missing ingress cannot reach Node"); } };
const unsigned = await proxy(new Request(root + "/api/admin/events", { headers: { "x-sr-context": "forged", "x-sr-signature": "0".repeat(64), "x-sr-role": "OWNER" } }), context);
check(unsigned.status === 421, "missing/forged ingress denied"); privateResponse(unsigned);
await Deno.writeTextFile(transferFile, JSON.stringify(transfers), { mode: 0o600 });
console.log(JSON.stringify({ generatedEdgeExecution: true, transferCount: transfers.length, streamingBodyPreserved: true, privateResponses: true }));
