import { localMode, publicOrigins, type HostingEnv } from "@/lib/hosting/config";
import { canonicalPath, under, type Surface } from "./policy";

/** Local fixtures use direct paths; hosted sessions navigate to their own surface. */
export function surfaceUrl(surface: Surface, pathname: string, env: HostingEnv = process.env) {
  pathname = canonicalPath(pathname);
  if (!under(pathname, `/${surface}`)) throw new Error("Invalid surface destination");
  return localMode(env) ? pathname : publicOrigins(env)[surface === "admin" ? 1 : 2] + pathname;
}

/** Canonicalize page navigation, never API requests or an untrusted hostname. */
export function canonicalPageUrl(hostname: string, pathname: string, search: string, method: string,
  env: HostingEnv = process.env): URL | null {
  if (localMode(env) || !["GET", "HEAD"].includes(method)) return null;
  pathname = canonicalPath(pathname);
  const origins = publicOrigins(env);
  const root = new URL(origins[0]).hostname;
  const admin = new URL(origins[1]).hostname;
  let origin: string | undefined;
  if (pathname === "/scanner.html" && (hostname === root || hostname === admin)) origin = origins[2];
  else if (hostname === root && under(pathname, "/admin")) origin = origins[1];
  else if (hostname === root && under(pathname, "/staff")) origin = origins[2];
  if (!origin) return null;
  const destination = new URL(pathname, origin);
  destination.search = search;
  return destination;
}
