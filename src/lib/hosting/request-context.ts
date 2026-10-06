import { deploymentId, localMode, trustedOriginAllowed, type HostingEnv } from "./config";
import { CONTEXT_HEADER, SIGNATURE_HEADER, encoder, hmacKey, parseEnvelope, signatureBytes, validIp, type TrustedRequestContext } from "./context-protocol";
import { canonicalPath } from "../auth/policy";
export function localContext(request: Request, env: HostingEnv = process.env): TrustedRequestContext {
  if (!localMode(env)) throw new Error("Local context is disabled");
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (host) { const value = new URL(`http://${host}`); url.host = value.host; }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]", "admin.localhost", "staff.localhost"].includes(url.hostname)) throw new Error("Non-loopback local host");
  const fixtureIp = env.SILENT_RAVE_ISOLATED_FIXTURE === "1" ? request.headers.get("x-sr-test-ip") : null;
  if (fixtureIp && !validIp(fixtureIp)) throw new Error("Invalid fixture IP");
  return { hostname: url.hostname, origin: url.origin, clientIp: fixtureIp || "127.0.0.1", method: request.method,
    originalPathname: url.pathname, deploymentId: "local" };
}
export async function readTrustedContext(request: Request, env: HostingEnv = process.env): Promise<TrustedRequestContext> {
  if (localMode(env)) return localContext(request, env);
  const raw = request.headers.get(CONTEXT_HEADER);
  const context = parseEnvelope(raw, deploymentId(env));
  if (!await crypto.subtle.verify("HMAC", await hmacKey(env.NETLIFY_INGRESS_SECRET, ["verify"]), signatureBytes(request.headers.get(SIGNATURE_HEADER)), encoder.encode(raw!))) throw new Error("Unverified request context");
  if (context.method !== request.method || canonicalPath(context.originalPathname) !== canonicalPath(new URL(request.url).pathname) || !trustedOriginAllowed(context.origin, context.originalPathname, env)) throw new Error("Context request mismatch");
  return context;
}
