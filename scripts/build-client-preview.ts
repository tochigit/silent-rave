import { mkdir, readFile, writeFile, copyFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { BunPlugin } from "bun";
import { previewEvents } from "../preview/fixtures";

const root = path.resolve(import.meta.dir, "..");
const output = path.join(root, "out", "client-preview");
const sourceHashes: Record<string, string> = {};
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function replaceOnce(source: string, expression: string | RegExp, replacement: string) {
  const changed = source.replace(expression, replacement);
  if (changed === source) throw new Error(`Preview adapter contract changed: ${expression}`);
  return changed;
}
const fixtureImport = JSON.stringify(path.join(root, "preview", "fixtures.ts"));
const plugin: BunPlugin = {
  name: "isolated-client-preview",
  setup(build) {
    build.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path: name }) => ({
      path: path.join(root, "preview", name.endsWith("link") ? "link.tsx" : "navigation.ts"),
    }));
    build.onResolve({ filter: /^(node:|@prisma\/|@\/lib\/(db|events\/catalog|content\/pages|auth|storage))/ }, () => {
      throw new Error("Server modules are forbidden in the client preview.");
    });
    build.onLoad({ filter: /\.tsx$/ }, async ({ path: file }) => {
      if (!file.startsWith(path.join(root, "src") + path.sep)) return;
      let source = await readFile(file, "utf8");
      const relative = path.relative(root, file).split(path.sep).join("/");
      sourceHashes[relative] = hash(source);
      if (relative === "src/app/(public)/page.tsx") {
        source = replaceOnce(source, /import \{ listEvents, catalogQuery \} from "@\/lib\/events\/catalog";/, `import { previewEvents } from ${fixtureImport};`);
        source = replaceOnce(source, "export default async function Home()", "export default function Home()");
        source = replaceOnce(source, /const listing = await listEvents\([\s\S]*?\)\.catch\(\(\) => null\);/, "const listing = { events: previewEvents };");
      } else if (relative === "src/components/customer/content-page.tsx") {
        source = replaceOnce(source, 'import { publicPage } from "@/lib/content/pages";', `import { previewPages } from ${fixtureImport};`);
        source = replaceOnce(source, "export async function ContentPage", "export function ContentPage");
        source = replaceOnce(source, "const page = await publicPage(slug);", "const page = previewPages[slug];");
      } else if (["checkout", "contact-form", "lookup"].some(name => relative === `src/components/customer/${name}.tsx`)) {
        // Remove submission code completely; disabled controls alone are insufficient.
        const start = source.indexOf("  async function submit(");
        const end = source.indexOf("\n  return (", start);
        if (start < 0 || end < start) throw new Error(`Submission adapter contract changed: ${relative}`);
        source = source.slice(0, start) + source.slice(end);
        source = replaceOnce(source, "onSubmit={submit}", "onSubmit={(event) => event.preventDefault()}");
        if (relative.endsWith("checkout.tsx")) source = replaceOnce(source, '<button type="submit" disabled={busy}>', '<button type="submit" disabled>');
        else source = replaceOnce(source, "<button disabled={busy}>", "<button disabled>");
      } else if (relative === "src/components/customer/cart.tsx") {
        source = replaceOnce(source, /"sr-cart"/g, '"sr-preview-cart"');
      }
      return { contents: source, loader: "tsx" };
    });
  },
};

// This script owns only its ignored generated directory. Reject redirected paths.
if (path.relative(root, output).split(path.sep).join("/") !== "out/client-preview") throw new Error("Unexpected preview output path.");
for (const directory of [path.join(root, "out"), output]) {
  const entry = await lstat(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (entry?.isSymbolicLink()) throw new Error("Preview output must not be a symbolic link.");
}
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, "assets"), { recursive: true });
const result = await Bun.build({
  entrypoints: [path.join(root, "preview", "app.tsx")], outdir: path.join(output, "assets"),
  naming: "preview.js", target: "browser", minify: true, sourcemap: "none",
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [plugin],
});
if (!result.success) throw new Error(result.logs.join("\n"));
const globals = await readFile(path.join(root, "src", "app", "globals.css"), "utf8");
if (!globals.includes('@import "./reference-rave.css";')) throw new Error("Reference style contract changed.");
const referenceStyles = await readFile(path.join(root, "src", "app", "reference-rave.css"), "utf8");
const css = await readFile(path.join(root, "node_modules", "tailwindcss", "preflight.css"), "utf8") + "\n" + referenceStyles + "\n" + await readFile(path.join(root, "preview", "preview.css"), "utf8");
sourceHashes["src/app/globals.css"] = hash(globals);
sourceHashes["src/app/reference-rave.css"] = hash(referenceStyles);
for (const file of ["references/Rave.html", "references/Rave.css"]) sourceHashes[file] = hash(await readFile(path.join(root, file)));
await writeFile(path.join(output, "assets", "preview.css"), css);
await copyFile(path.join(root, "public", "fixture-poster.jpeg"), path.join(output, "assets", "poster.jpeg"));
const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; font-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="description" content="Silent Rave website design preview with sample content."><title>Silent Rave · Design preview</title><link rel="stylesheet" href="/assets/preview.css"><script src="/assets/preview.js" defer></script></head><body><div id="root"></div><noscript><p>This design preview needs JavaScript enabled.</p></noscript></body></html>\n`;
const routes = ["", "events", "about", "contact", "cart", "checkout", "lookup", ...previewEvents.map(event => `event/${event.slug}`)];
for (const route of routes) {
  const directory = path.join(output, route); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html);
}
await writeFile(path.join(output, "404.html"), html);
await writeFile(path.join(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
await writeFile(path.join(output, "_headers"), `/*\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`);
const bundle = await readFile(path.join(output, "assets", "preview.js"), "utf8");
for (const forbidden of ["/api/checkout/initialize", "/api/contact", "/api/orders/lookup", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "RESEND_API_KEY"]) {
  if (bundle.includes(forbidden)) throw new Error(`Forbidden content in preview: ${forbidden}`);
}
await mkdir(path.join(root, "reports"), { recursive: true });
await writeFile(path.join(root, "reports", "client-preview-build.json"), JSON.stringify({
  output: "out/client-preview", routes, sourceHashes, bundleBytes: Buffer.byteLength(bundle),
  bundleSha256: hash(bundle), cssSha256: hash(css), backend: "none", submissions: "removed", networkConnections: "blocked",
}, null, 2) + "\n");
console.log(`Built static client preview: ${routes.length} pages, ${Buffer.byteLength(bundle)} JS bytes. No backend or submission endpoints.`);
