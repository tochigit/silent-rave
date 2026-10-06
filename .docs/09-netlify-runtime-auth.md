# Step 5C.1 Netlify runtime/auth compatibility

Prepared 2026-10-06, Africa/Lagos. **Incomplete: the first integration gate failed.**
This is the blocker report and revised proposal required by the Desktop Step 5B
plan. Netlify remains selected. No application adaptation or hosted setup has
been performed. Review the design revision before resuming this milestone.

## Verified baseline

Live GitHub confirmed PR #5 merged, main/local HEAD/fetched origin/main at
`3b69187d017403fb84777f9c3406c68bb3e96a55`, and main run
[37232720318](https://github.com/tochigit/silent-rave/actions/runs/37232720318)
successful on that exact SHA. The initial tree was clean; earlier branches were
preserved. Current branch: `feat/step5c1-netlify-runtime-auth` (base main),
[draft PR #6](https://github.com/tochigit/silent-rave/pull/6).

The authorized first milestone retains Next 16.1.3, Prisma 6.19.2, Sharp, Noto/OFL,
scanner assets and central proxy authorization. It replaces the proxy's native
database imports with a protected Node session-decision broker and independently
revalidates live sessions/roles in Node page/API guards. Later storage, shared
limits, scheduler, hosted configuration and deployment are outside this step.

## Exact blocker

The Step 5B plan places a user Edge Function before generated Next middleware to
strip client-supplied `x-sr-*` headers and sign platform host/IP metadata. That
ordering is unavailable through ordinary user declarations. Netlify prioritizes
framework/integration declarations ahead of user TOML and inline functions.
[Declaration processing order](https://docs.netlify.com/build/edge-functions/declarations/#declaration-processing-order)

The published adapter is now **@netlify/plugin-nextjs 5.16.2**, gitHead
`36cf34c6031a8a5b02587fd9d45edecddc6e60d8`; Step 5B inspected 5.16.1.
It emits `___netlify-edge-handler-node-middleware` in its generated Edge manifest.
[Adapter implementation](https://github.com/opennextjs/opennextjs-netlify/blob/36cf34c6031a8a5b02587fd9d45edecddc6e60d8/src/build/functions/edge.ts)

Published **@netlify/edge-bundler 16.1.2**, gitHead
`56df60307c59031b2ab044446d634b10851459e3`, merges integration declarations before
user declarations. The first user TOML entry or an alphabetic/inline change cannot
precede the generated proxy.
[Declaration merger](https://github.com/netlify/build/blob/56df60307c59031b2ab044446d634b10851459e3/packages/edge-bundler/node/declaration.ts)

Actual local diagnostic using both published packages:

```text
Existing proposal, matching /admin:
  1. ___netlify-edge-handler-node-middleware
  2. request-context (user TOML declaration)
```

The proxy needs signed context before host/authorization decisions. Failing closed
would deny legitimate requests; accepting forwarded headers would abandon the
selected trust boundary. The saved plan explicitly requires stopping Step 5C.1
and producing an exact blocker plus a revised design if this ordering fails.

The unchanged proxy also imports Prisma's native engine. Historical local trace
files contain the Windows .node engine rejected by this adapter in Node middleware.
That second issue remains for the planned broker extraction; it was not rerun as
a fresh application build in this checkpoint.

## Reproduction and limits

Evidence: [ordering snapshot](../reports/step5c1-edge-order.json) and
[diagnostic source](../reports/step5c1-order-probe.mjs). Local Node was 26.5.0;
the eventual build/runtime contract is still Node 24 and Bun 1.3.14.

Restore the two exact public npm tarballs into these ignored package directories:

| Package | Tarball | Extract under |
|---|---|---|
| OpenNext 5.16.2 | https://registry.npmjs.org/@netlify/plugin-nextjs/-/plugin-nextjs-5.16.2.tgz | `.test-runtime/netlify-adapter-source/` |
| Edge bundler 16.1.2 | https://registry.npmjs.org/@netlify/edge-bundler/-/edge-bundler-16.1.2.tgz | `.test-runtime/netlify-edge-bundler-source/` |

Each archive contains a `package/` directory. Run from the repository root:

```powershell
node reports/step5c1-order-probe.mjs
```

The diagnostic creates a synthetic Node handler with no native traces, calls the
actual adapter's `createEdgeHandlers`, then the actual bundler's `mergeDeclarations`.
Exit 0 means its assertions reproduced the blocker and proposed declaration order;
it does **not** mean compatibility passed. No full Netlify build, function bundling/
execution, hosted connection, DB, mail or deployment occurs. Downloaded packages
and generated runtime copies stay ignored; only the small script/result are tracked.

Both downloaded archives matched their published npm checksums. The final
diagnostic ran successfully and diff checks passed. Local ESLint under Bun stalled
and was stopped; it is incomplete, not a pass. Standard lint and the unchanged
application regression/build results come from exact-head PR CI; see the PR's
updated validation evidence. Those checks cannot establish the proposed integration.

## Revised proposal for review

Use an explicitly ordered **OpenNext adapter plus local ingress build integration**.
Declare the adapter and then our integration as build plugins. Pin the inspected
adapter version in tooling/locks and test updates before accepting them. This
replaces the automatically managed adapter preference: ordering now depends on
an inspected integration contract. No Next framework or Prisma engine rewrite.

The local integration's `onBuild` must run after OpenNext emits its Edge manifest
and before function bundling. It copies ingress into the generated integration
directory and prepends its declaration to that same manifest. Keep all generated
Next middleware declarations and runtime source intact. Netlify documents
`onBuild` before bundling; `onPostBuild` is too late for this transformation.
[Build plugin events](https://docs.netlify.com/extend/develop-and-share/develop-build-plugins/#plug-into-events)

Desired final integration order on applicable dynamic paths:

```text
1. request-context (integration-generated ingress)
2. ___netlify-edge-handler-node-middleware
3. Node page/API handler with independent live authorization
```

Prepending ingress to the integration declarations produced this order in the
local merger diagnostic. Actual plugin lifecycle, bundling, request propagation
and hosted behavior remain unverified. This is a narrow feasibility result.

The integration must reject missing/unrecognized manifests, unsupported adapter
versions, duplicate/unexpected middleware entries and inability to prove ingress
first. Reruns must be idempotent. Record adapter version/final manifest fingerprint
without secrets. Inspect final packaged routing, not only intermediate files.
Never create a user bypass header or trust client forwarding headers.

Retain platform Request URL/`context.ip`, reserved-header stripping and versioned
WebCrypto HMAC binding deployment, method, original path, full origin and IP, with
30s validity at the first handler and separate ingress/broker keys. Do not buffer
request bodies or echo metadata. Keep proxy native-free, centrally calling its
fixed Node broker. Unknown hosts, broker failure and invalid hosted context deny.

Tradeoff: a small build integration is coupled to OpenNext's manifest format;
adapter upgrades become reviewed changes. Prove this new contract before the
rest of Step 5C.1. If it fails, save the specific blocker and review an alternative.

## Remaining acceptance and stop boundary

After approval, first run an isolated credential-free Netlify build with the
explicit plugin order. Prove final Edge execution calls ingress before proxy,
preserves original URL/method and transfers signed context into Node handlers.
Test spoofing, invalid metadata, redirects/rewrites and direct function paths.
Declaration sorting alone is insufficient.

Then complete bounded 8s broker calls, independent live role/password guards,
conditional DB-time renewal, canonical hosts/full Origins, private responses and
matcher/future-route coverage. Prove Node Sharp/Prisma/font/PDF/scanner packaging,
no native proxy imports or bundled secrets, full auth matrix, all 176 regressions
plus new cases, lint/types and exact-head Windows/Linux CI. Actual hosted behavior
remains separately unverified.

This checkpoint is documentation plus a synthetic diagnostic: an incomplete
DRAFT PR. Review before continuing **the same Step 5C.1**. No merge, branch deletion,
Step 5C.2, hosted configuration/migrations, DNS, purchases, deployment or real
delivery is authorized.
