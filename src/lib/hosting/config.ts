import buildIdentity from "./build-identity.json";

export type HostingEnv = Record<string, string | undefined>;
function netlifyIdentity(env: HostingEnv) {
  // The build wrapper compiles only public identity into this module. The
  // tracked empty template is restored after building for local source tests.
  const builtId = buildIdentity.id || env.SR_NETLIFY_DEPLOY_ID;
  const builtSite = buildIdentity.site || env.SR_NETLIFY_SITE_NAME;
  if (!!builtId !== !!builtSite) throw new Error("Incomplete deployment metadata");
  const id = builtId || env.DEPLOY_ID;
  const site = builtSite || env.SITE_NAME;
  if (env.HOST_PLATFORM !== "netlify" || !id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) ||
    (site && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(site)) ||
    (builtId && env.DEPLOY_ID && builtId !== env.DEPLOY_ID) ||
    (builtSite && env.SITE_NAME && builtSite !== env.SITE_NAME)) throw new Error("Invalid deployment metadata");
  return { id, site };
}
export function localMode(env: HostingEnv = process.env) {
  return env.HOST_PLATFORM === "local" && env.NODE_ENV !== "production" && env.ROOT_DOMAIN === "localhost";
}
export function publicOrigins(env: HostingEnv = process.env): string[] {
  const root = env.ROOT_DOMAIN?.trim().toLowerCase();
  const base = new URL(env.PUBLIC_BASE_URL || "");
  if (!root || base.hostname !== root || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Invalid public origin configuration");
  if (localMode(env) ? base.protocol !== "http:" : base.protocol !== "https:" || !!base.port) throw new Error("Invalid public origin configuration");
  return [base.origin, `${base.protocol}//admin.${base.host}`, `${base.protocol}//staff.${base.host}`];
}
export function internalOrigin(env: HostingEnv = process.env): string {
  const identity = localMode(env) ? null : netlifyIdentity(env);
  const inferred = identity?.site ? "https://" + identity.id + "--" + identity.site + ".netlify.app" : "";
  const url = new URL(env.AUTH_INTERNAL_BASE_URL || inferred);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid broker origin configuration");
  if (localMode(env)) {
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Invalid local broker origin");
  } else if (url.protocol !== "https:" || url.port || !url.hostname.startsWith(identity!.id + "--") || !/^[a-z0-9-]+--[a-z0-9-]+\.netlify\.app$/.test(url.hostname) ||
    (inferred && url.origin !== inferred)) {
    throw new Error("Broker must target this immutable deployment");
  }
  return url.origin;
}
export function deploymentId(env: HostingEnv = process.env) {
  if (localMode(env)) return "local";
  return netlifyIdentity(env).id;
}
export function trustedOriginAllowed(origin: string, path: string, env: HostingEnv = process.env) {
  if (publicOrigins(env).includes(origin)) return true;
  if (path === "/api/internal/session-decision" && origin === internalOrigin(env)) return true;
  // Readiness and fixture transport use loopback, never a hosted browser exception.
  if (localMode(env)) {
    const url = new URL(origin);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  }
  return false;
}
