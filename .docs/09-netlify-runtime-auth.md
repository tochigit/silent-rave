# Step 5C.1 Netlify runtime/auth compatibility

Current runtime configuration changes are documented in
[NETLIFY_RUNTIME_CONFIGURATION.md](NETLIFY_RUNTIME_CONFIGURATION.md). Netlify's
public build identity is now embedded in Node and Edge handlers, so hosted Node
functions do not need a runtime DEPLOY_ID or AUTH_INTERNAL_BASE_URL setting.
The results and stop boundary below describe the historical Step 5C.1 milestone.

Status: **COMPLETE; STOPPED FOR PR REVIEW**, 2026-10-06. The approved build
integration and runtime adaptation are implemented on
`feat/step5c1-netlify-runtime-auth`, [PR #6](https://github.com/tochigit/silent-rave/pull/6).
Both full Windows/Linux jobs and GitGuardian passed on implementation head
`5ca3b08d782bb944044e4582fe12158b08747789` in
[CI 37533098994](https://github.com/tochigit/silent-rave/actions/runs/37533098994).
Final publication checks are recorded in the PR and Desktop handoff. No hosted
setup, data access, deployment, merge or later milestone was performed.

## Build integration and proof boundary

The original user Edge declaration ran after generated Next middleware. The
published-package diagnostic in reports/step5c1-edge-order.json reproduces that
historical blocker; it is not current acceptance.
[Declaration order](https://docs.netlify.com/build/edge-functions/declarations/#declaration-processing-order)

The revision explicitly orders pinned @netlify/plugin-nextjs 5.16.2 then the local
ingress plugin. onBuild copies ingress into the generated integration directory
and prepends its declaration to the same manifest, retaining Next's handlers.
Unknown versions/declarations and duplicate patterns fail the build.
Hash-guarded corrections to the generated CJS loader and virtual cwd restore
Windows Deno URL/path semantics; Linux behavior is retained. The entry
module exports only lifecycle events; helpers live in integration.mjs.
[Build events](https://docs.netlify.com/extend/develop-and-share/develop-build-plugins/#plug-into-events)

onPostBuild validates the final routing emitted by pinned edge-bundler 16.1.2 and
records a SHA-256 fingerprint. Dynamic paths require ingress, generated Next proxy,
then independently authorized Node handlers. Adapter upgrades require review and
repeat acceptance because its manifest contract is part of the trust boundary.
[Adapter source](https://github.com/opennextjs/opennextjs-netlify/blob/36cf34c6031a8a5b02587fd9d45edecddc6e60d8/src/build/functions/edge.ts)
[Bundler source](https://github.com/netlify/build/blob/56df60307c59031b2ab044446d634b10851459e3/packages/edge-bundler/node/declaration.ts)

Acceptance executes generated ingress and the actual adapter proxy in supported
Deno using final routing. It checks spoofing, future/dotted/encoded/RSC paths,
rewrites, stream preservation and signed metadata transfer into Node. This is local
generated-handler execution. Hosted ESZIP execution, request propagation and
provider runtime variable scopes remain unverified.

## Context, broker and live authorization

Ingress uses the platform Request URL, context.ip and context.deploy.id. It strips
client x-sr-* and known middleware bypass headers and signs a versioned HMAC
binding deployment, full origin, method, original path, IP and issue time. It does
not read the request body. Proxy WebCrypto and Node constant-time HMAC verification
require separate ingress/broker keys and a 30-second context lifetime.
[Edge API](https://docs.netlify.com/build/edge-functions/api/)

The central proxy contains pure policy and bounded fetch code, with no Prisma,
Sharp, fonts, bcrypt or native engine. Protected pages/APIs including future routes
and RSC/prefetch call a fixed deployment-specific Node broker. Unknown hosts,
invalid context, cross-surface paths and direct function URLs deny. Login exemptions
are exact. Private responses use browser/CDN no-store, no-referrer and noindex.
Node page/API guards independently check live activity, role and temporary password.

The broker checks its key before body parsing or database work. Strict bounded
input produces only version, deployment, decision and optional approved expiry.
The proxy disables redirects, credentials and caching and imposes an eight-second
fetch-and-stream deadline. Malformed, oversized or unavailable replies deny.

Opaque cookies preserve their original token and shared root-domain scope. Session
creation, validation and renewal use database time. Renewal locks user then session
and extends only live sessions within three hours of expiry. It never shortens an
expiry or revives logout, deactivation or expiry during lock waits. Broker live
state is checked again after renewal. Mutation Origin checks require the complete
trusted configured origin; forwarding headers do not define identity or origin.

## Build and runtime configuration

Next 16.1.3, Prisma 6.19.2, Sharp 0.34.5, Node 24 and Bun 1.3.14 are retained.
The build wrapper allowlists OS/tool variables, removes runtime/provider/owner/
fixture secrets, sets unreachable loopback database placeholders and rejects
dotenv-containing checkouts without reading them. It generates Prisma/scanner/app
artifacts and never seeds or migrates. The separate locked tools/netlify CLI runs
build --offline without login/link/token/deployment. Public synthetic canaries and
output scans check secret removal; proxy traces must remain native-free.
[Offline CLI build](https://cli.netlify.com/commands/build/)

Runtime requires HOST_PLATFORM=netlify, HTTPS PUBLIC_BASE_URL and ROOT_DOMAIN,
public DEPLOY_ID/SITE_NAME captured during the build, PROXY_AUTH_SECRET
and distinct NETLIFY_INGRESS_SECRET. The broker origin is derived from the embedded
identity. An optional AUTH_INTERNAL_BASE_URL must match that exact deployment.
Missing configuration denies. Edge and Node
runtime scopes require later hosted setup and smoke tests; TOML build variables
alone do not supply runtime secrets. Local mode is nonproduction loopback only.
[Edge variables](https://docs.netlify.com/build/edge-functions/environment-variables/)

## Completed acceptance and remaining plan

Both systems passed lint/types, 8 policy cases, guard audit, readiness checks,
scanner generation and all **183 regressions** (176 baseline + 6 runtime + 1 outage).
Actual offline builds passed final Edge ordering, native-free traces and secret/
dotenv scans. Generated Deno execution proved spoof rejection, central protection,
private responses, rewrites/body streaming and signed-context transfer into Node.

Isolated final Node ZIPs loaded real Prisma/Sharp, queried disposable Postgres,
submitted/sanitized an EXIF image and independently checked live guards/broker.
Packaged Noto/OFL hashes match; rendered PDFs verified embedded diacritics, Lagos
date and exact stored QR decoding. The Netlify framework cache/context were
synthetic. Neither hosted provider execution nor its runtime secret scopes have
been verified. [Saved evidence](../reports/step5c1-ci-37533098994/)

Complete ONLY Step 5C.1, then stop for review. No merge, branch deletion, hosted
setup/query/migration, DNS, purchase, deployment, permanent owner/password change,
real delivery or Step 5C.2. The remaining Step 5B sequence is upload limits (5C.2),
durable storage (5C.3), shared limits (5C.4), scheduler/mail budgets (5C.5), then
database privacy/polling/release preparation (5C.6), each with its own review.
