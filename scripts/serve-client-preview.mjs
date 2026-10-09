import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("out/client-preview");
const manifest = JSON.parse(await readFile("reports/client-preview-build.json", "utf8"));
const allowed = new Set(["assets/preview.js", "assets/preview.css", "assets/poster.jpeg", "404.html", "robots.txt", ...manifest.fonts.map(font => `fonts/${font}`), ...manifest.routes.map(route => route ? `${route}/index.html` : "index.html")]);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpeg": "image/jpeg", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = path.join(file, "index.html");
    let status = 200;
    if (!allowed.has(path.relative(root, file).split(path.sep).join("/"))) { file = path.join(root, "404.html"); status = 404; }
    res.writeHead(status, { "content-type": types[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  } catch { res.writeHead(400); res.end("Preview request unavailable."); }
});
server.listen(4173, "127.0.0.1", () => console.log("Silent Rave design preview: http://127.0.0.1:4173 — sample content, no payments or emails. Ctrl+C stops it."));
