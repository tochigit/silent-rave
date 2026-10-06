import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve('.test-runtime/step5c1-order-fixture');
const adapter = resolve('.test-runtime/netlify-adapter-source/package');
const bundler = resolve('.test-runtime/netlify-edge-bundler-source/package');
const packageInfo = JSON.parse(await readFile(join(adapter, 'package.json'), 'utf8'));
const bundlerInfo = JSON.parse(await readFile(join(bundler, 'package.json'), 'utf8'));
assert.equal(packageInfo.version, '5.16.2');
assert.equal(bundlerInfo.version, '16.1.2');
const { createEdgeHandlers } = await import(pathToFileURL(join(adapter, 'dist/build/functions/edge.js')));
const { mergeDeclarations } = await import(pathToFileURL(join(bundler, 'dist/node/declaration.js')));
await mkdir(join(root, 'server'), { recursive: true });
await writeFile(join(root, 'server/middleware.js'), 'module.exports = async () => ({ response: new Response(null) });\n');
await writeFile(join(root, 'server/middleware.js.nft.json'), JSON.stringify({ version: 1, files: [] }));
const ctx = {
  edgeFunctionsDir: join(root, 'generated-edge'),
  pluginDir: adapter.replaceAll('\\', '/'),
  standaloneDir: root.replaceAll('\\', '/'),
  nextDistDir: '.',
  publishDir: root.replaceAll('\\', '/'),
  buildConfig: {},
  pluginName: packageInfo.name,
  pluginVersion: packageInfo.version,
  getMiddlewareManifest: async () => ({ middleware: {} }),
  getFunctionsConfigManifest: async () => ({ functions: {
    '/_middleware': { runtime: 'nodejs', matchers: [
      { regexp: '^/admin(?:/.*)?$', originalSource: '/admin/:path*' },
      { regexp: '^/api/admin(?:/.*)?$', originalSource: '/api/admin/:path*' },
    ] },
  } }),
};
await createEdgeHandlers(ctx);
const manifest = JSON.parse(await readFile(join(ctx.edgeFunctionsDir, 'manifest.json'), 'utf8'));
const custom = { function: 'request-context', path: '/*' };
const declarations = mergeDeclarations([custom], {}, {}, manifest.functions, {});
const matched = declarations.filter(d => !d.pattern || new RegExp(d.pattern).test('/admin'));
assert.equal(manifest.functions[0].generator, '@netlify/plugin-nextjs@5.16.2');
assert.deepEqual(matched.map(d => d.function), ['___netlify-edge-handler-node-middleware', 'request-context']);
const proposedDeclarations = mergeDeclarations([], {}, {}, [
  { ...custom, generator: 'silent-rave/ingress@proposal' }, ...manifest.functions,
], {});
const proposedOrder = proposedDeclarations.filter(d => !d.pattern || new RegExp(d.pattern).test('/admin')).map(d => d.function);
assert.deepEqual(proposedOrder, ['request-context', '___netlify-edge-handler-node-middleware']);
const output = {
  date: '2026-10-06',
  scope: 'Synthetic local adapter generation and declaration merge; no app build, Edge execution, deployment or database',
  adapter: { version: packageInfo.version, gitHead: '36cf34c6031a8a5b02587fd9d45edecddc6e60d8' },
  edgeBundler: { version: bundlerInfo.version, gitHead: '56df60307c59031b2ab044446d634b10851459e3' },
  generatedManifest: manifest,
  userTomlDeclaration: custom,
  matchedAdminOrder: matched.map(d => d.function),
  proposedInternalManifestOrder: proposedOrder,
  proposalLimit: 'Declaration merge only; build hook integration and runtime are UNVERIFIED',
  gate: 'FAILED: framework proxy precedes user ingress bridge',
};
await writeFile(resolve('reports/step5c1-edge-order.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
