The locked Netlify CLI 27.11.2 is isolated from application dependencies. Copy
this package.json and package-lock.json to `.test-runtime/netlify-tools`, then
run `npm ci --prefix .test-runtime/netlify-tools --ignore-scripts --no-audit --no-fund`.
`bun --no-env-file scripts/build-netlify-offline.ts` builds and bundles locally
with `netlify build --offline`. It never links, deploys, or logs into a project.

The application pins `@netlify/plugin-nextjs` 5.16.2 independently. Both application
lockfiles remain authoritative for the app; this lockfile only supports adapter
verification in CI and local acceptance.
