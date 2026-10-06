import { createHmac, timingSafeEqual } from "node:crypto";
import { deploymentId, localMode, trustedOriginAllowed, type HostingEnv } from "./config";
import { CONTEXT_HEADER, SIGNATURE_HEADER, parseEnvelope, signatureBytes, type TrustedRequestContext } from "./context-protocol";
import { localContext } from "./request-context";
import { canonicalPath, routePolicy } from "../auth/policy";
export function readContextHeaders(headers: Headers, env: HostingEnv = process.env): TrustedRequestContext {
  const raw = headers.get(CONTEXT_HEADER);
  const context = parseEnvelope(raw, deploymentId(env));
  if (!env.NETLIFY_INGRESS_SECRET || env.NETLIFY_INGRESS_SECRET.length < 32) throw new Error("Missing ingress key");
  const expected = createHmac("sha256", env.NETLIFY_INGRESS_SECRET).update(raw!).digest();
  if (!timingSafeEqual(expected, signatureBytes(headers.get(SIGNATURE_HEADER))) || !trustedOriginAllowed(context.origin, context.originalPathname, env)) throw new Error("Unverified request context");
  return context;
}
export function readTrustedContextNode(request: Request, env: HostingEnv = process.env) {
  if (localMode(env)) return localContext(request, env);
  const context = readContextHeaders(request.headers, env);
  const actual = canonicalPath(new URL(request.url).pathname);
  const original = canonicalPath(context.originalPathname);
  const effective = routePolicy(context.hostname, original, env.ROOT_DOMAIN).effectivePathname;
  if (context.method !== request.method || (actual !== original && actual !== effective)) throw new Error("Context request mismatch");
  return context;
}
