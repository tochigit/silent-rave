import { randomUUID } from "node:crypto";
export type FakeObject = { bytes: Uint8Array; contentType: string; metadata: Record<string, string> };
/** Owned loopback service, never a provider. Test controls are unavailable in application code. */
export function startFakeStorage() {
  const objects = new Map<string, FakeObject>();
  const requests: Array<{ method: string; path: string; headers: Headers }> = [];
  const control = randomUUID();
  let fault: { operation?: string; status?: number; code?: string; contentType?: string; size?: number; delay?: number; malformed?: boolean; metadata?: boolean; once?: boolean } | null = null;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/control" && request.headers.get("x-fixture-control") === control) {
      const command = await request.json();
      if (command.remove) objects.delete(command.remove);
      if (command.corrupt) { const object = objects.get(command.corrupt); if (object) object.metadata = {}; }
      if (command.fault !== undefined) fault = command.fault;
      return Response.json({ count: objects.size });
    }
    const match = /^\/storage\/v1\/object\/(?:(authenticated|info)\/)?(.+)$/.exec(url.pathname);
    if (!match) return Response.json({ code: "NoSuchKey" }, { status: 404 });
    requests.push({ method: request.method, path: url.pathname, headers: request.headers });
    const operation = match[1] ?? "put";
    if (fault && (!fault.operation || fault.operation === operation)) {
      const active = fault; if (active.once) fault = null;
      if (active.delay) await Bun.sleep(active.delay);
      if (active.status) return active.malformed ? new Response("upstream HTML", { status: active.status }) : Response.json({ code: active.code ?? "Unavailable" }, { status: active.status });
      if (active.size) return new Response(new Uint8Array(active.size), { headers: { "content-type": active.contentType ?? "application/pdf" } });
      if (active.metadata && operation === "info") return Response.json({ size: 1, content_type: "application/pdf", metadata: {} });
    }
    const key = match[2];
    if (request.method === "POST" && operation === "put") {
      if (request.headers.get("x-upsert") !== "false") return Response.json({ code: "UnsafeUpsert" }, { status: 400 });
      const bytes = new Uint8Array(await request.arrayBuffer());
      const metadata = JSON.parse(Buffer.from(request.headers.get("x-metadata") ?? "", "base64").toString());
      // Check after all awaits: parallel bodies must not both pass a stale absence check.
      if (objects.has(key)) return Response.json({ code: "Duplicate" }, { status: 409 });
      objects.set(key, { bytes, metadata, contentType: request.headers.get("content-type")! });
      return Response.json({ Key: key }, { status: 200 });
    }
    const object = objects.get(key);
    if (!object) return Response.json({ code: "NoSuchKey" }, { status: 404 });
    if (operation === "info") return Response.json({ size: object.bytes.length, content_type: object.contentType, metadata: object.metadata });
    return new Response(new Uint8Array(object.bytes), { headers: { "content-type": object.contentType } });
  } });
  return { objects, requests, server, env: { SUPABASE_URL: server.url.origin, SUPABASE_STORAGE_SERVER_KEY: "sb_secret_synthetic_fixture_storage", SR_PRIVATE_BUCKET: "sr-private", SR_BANNER_BUCKET: "sr-banners", STORAGE_DRIVER: "supabase", FAKE_STORAGE_CONTROL_KEY: control } };
}
