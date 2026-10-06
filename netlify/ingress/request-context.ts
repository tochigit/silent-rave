// Build integration copies this next to context-protocol.ts into the internal
// Edge directory. It deliberately has no inline/user declaration.
import { CONTEXT_HEADER, SIGNATURE_HEADER, encoder, hex, hmacKey, type Envelope } from "../../src/lib/hosting/context-protocol.ts";
declare const Netlify: { env: { get(name: string): string | undefined } };
type Context = { ip: string; deploy: { id: string }; next(request: Request): Promise<Response> };
export default async function ingress(request: Request, context: Context) {
  try {
    const headers = new Headers(request.headers);
    for (const key of [...headers.keys()]) if (key.startsWith("x-sr-")) headers.delete(key);
    for (const key of ["x-middleware-subrequest", "x-middleware-subrequest-id", "x-middleware-invoke", "x-nf-next-middleware", "x-nf-debug-logging", "x-next-debug-logging"]) headers.delete(key);
    const url = new URL(request.url);
    const envelope: Envelope = { v: 1, hostname: url.hostname, origin: url.origin, clientIp: context.ip,
      method: request.method, originalPathname: url.pathname, deploymentId: context.deploy.id, issuedAt: Date.now() };
    if (!context.ip || !context.deploy.id) throw new Error("Missing platform context");
    const raw = JSON.stringify(envelope);
    const signature = await crypto.subtle.sign("HMAC", await hmacKey(Netlify.env.get("NETLIFY_INGRESS_SECRET"), ["sign"]), encoder.encode(raw));
    headers.set(CONTEXT_HEADER, raw); headers.set(SIGNATURE_HEADER, hex(signature));
    return await context.next(new Request(request, { headers }));
  } catch {
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "private, no-store",
      "Netlify-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
  }
}
