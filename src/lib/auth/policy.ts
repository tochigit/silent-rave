// Shared with the Edge proxy: no database, native modules, or Node imports.
export const SESSION_COOKIE_NAME = "sr_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_REFRESH_THRESHOLD_MS = 3 * 60 * 60 * 1000;
export const ADMIN_API_ROLES = ["OWNER"] as const;
export const STAFF_API_ROLES = ["STAFF", "OWNER"] as const;
export type Surface = "admin" | "staff";
// Public, first-party PWA shell only. Ticket data and sync remain guarded APIs.
export const SCANNER_ASSETS = [
  "/scanner.html", "/scanner.js", "/scanner.css", "/scanner-sw.js",
  "/scanner.webmanifest", "/scanner-icon.svg", "/scanner-icon-192.png", "/scanner-icon-512.png",
] as const;
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
export function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/");
}
export function canonicalPath(path: string) {
  if (/%(?:2f|5c)/i.test(path)) throw new Error("Encoded path separator");
  const decoded = decodeURIComponent(path);
  if (!decoded.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(decoded) || /%[a-f0-9]{2}/i.test(decoded) || decoded.split("/").some(part => part === "." || part === "..")) throw new Error("Ambiguous path");
  return decoded;
}
export function sessionCookieOptions(expires: Date) {
  const root = (process.env.ROOT_DOMAIN ?? "localhost").trim().toLowerCase();
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production",
    path: "/", domain: root === "localhost" ? undefined : `.${root}`, expires };
}
export function routePolicy(hostname: string, pathname: string, rootDomain = process.env.ROOT_DOMAIN ?? "localhost") {
  pathname = canonicalPath(pathname);
  const root = rootDomain.trim().toLowerCase();
  const hostSurface = hostname === `admin.${root}` ? "admin" : hostname === `staff.${root}` ? "staff" : null;
  const crossSurface = hostSurface === "admin" && (under(pathname, "/staff") || under(pathname, "/api/staff")) ||
    hostSurface === "staff" && (under(pathname, "/admin") || under(pathname, "/api/admin"));
  const apiSurface = under(pathname, "/api/admin") ? "admin" : under(pathname, "/api/staff") ? "staff" : null;
  const effectivePathname = hostSurface && !SCANNER_ASSETS.some(path => path === pathname) && !under(pathname, "/api") && !under(pathname, `/${hostSurface}`)
    ? `/${hostSurface}${pathname === "/" ? "" : pathname}` : pathname;
  const pageSurface = under(effectivePathname, "/admin") ? "admin" : under(effectivePathname, "/staff") ? "staff" : null;
  const surface: Surface | null = apiSurface ?? pageSurface;
  const login = surface !== null && effectivePathname.replace(/\/$/, "") === `/${surface}/login`;
  return { surface, api: apiSurface !== null, effectivePathname, login, crossSurface,
    passwordPage: effectivePathname.replace(/\/$/, "") === "/staff/password",
    loginPath: hostSurface ? "/login" : `/${surface}/login` };
}
export type DecisionRequest = { v: 1; token: string; surface: Surface; method: string;
  originalPathname: string; effectivePathname: string; publicOrigin: string };
export type Decision = { v: 1; deploymentId: string; decision: "ALLOW" | "UNAUTHENTICATED" | "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED";
  renewExpiresAt?: string };
