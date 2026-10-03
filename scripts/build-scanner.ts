import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
const build = await Bun.build({
  entrypoints: ["src/scanner/app.ts"],
  outdir: "public",
  naming: "scanner.js",
  target: "browser",
  minify: true,
});
if (!build.success) throw new Error(build.logs.join("\n"));
for (const size of [192, 512]) await sharp(await readFile("public/scanner-icon.svg")).resize(size, size).png().toFile(`public/scanner-icon-${size}.png`);
const hash = createHash("sha256");
for (const name of ["scanner.js", "scanner.html", "scanner.css"])
  hash.update(await readFile(`public/${name}`));
const version = hash.digest("hex").slice(0, 16);
// Cache only the generic shell and public code. Never cache API, login, RSC,
// financial pages, session cookies or personalized HTML.
await writeFile(
  "public/scanner-sw.js",
  `const CACHE='sr-scanner-${version}';const SHELL=['/scanner.html','/scanner.js','/scanner.css','/scanner-icon.svg','/scanner.webmanifest','/scanner-icon-192.png','/scanner-icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sr-scanner-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!SHELL.includes(u.pathname))return;e.respondWith(caches.open(CACHE).then(c=>c.match(e.request).then(r=>r||fetch(e.request))));});`,
);
console.log(
  `Built first-party scanner assets (${version}); no private data embedded.`,
);
