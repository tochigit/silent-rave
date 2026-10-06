import { test, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { SupabaseStorage } from "@/lib/storage/supabase";
import { StorageCollisionError, StorageUnavailableError } from "@/lib/storage/errors";
import { signStoragePath, verifyStorageSignature } from "@/lib/storage/signatures";
import { PDF_OBJECT_BYTES } from "@/lib/uploads/limits";
import { startFakeStorage } from "./fake-storage";
import "../phase3b/load-env";
const pdfKey = () => `tickets/${randomUUID()}/${"a".repeat(64)}.pdf`;
const pdf = Buffer.from("%PDF-1.7\nsynthetic adapter artifact");
const config = (fake: ReturnType<typeof startFakeStorage>, key = fake.env.SUPABASE_STORAGE_SERVER_KEY) => ({ url: fake.env.SUPABASE_URL, serverKey: key });
async function fault(fake: ReturnType<typeof startFakeStorage>, active: unknown) { await fetch(fake.env.SUPABASE_URL + "/control", { method: "POST", headers: { "x-fixture-control": fake.env.FAKE_STORAGE_CONTROL_KEY, "content-type": "application/json" }, body: JSON.stringify({ fault: active }) }); }

test("REST secret/legacy key headers, namespace validation before I/O and fixed application signing", async () => {
  const fake = startFakeStorage();
  try {
    const legacy = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.synthetic`;
    for (const key of [fake.env.SUPABASE_STORAGE_SERVER_KEY, legacy]) {
      const adapter = new SupabaseStorage(config(fake, key)); const object = pdfKey();
      await adapter.putObject(object, pdf, "application/pdf");
      expect((await adapter.getObject(object))?.bytes).toEqual(new Uint8Array(pdf));
      const headers = fake.requests.at(-1)!.headers;
      expect(headers.get("apikey")).toBe(key);
      expect(headers.get("authorization")).toBe(key === legacy ? `Bearer ${legacy}` : null);
      expect(headers.get("cookie")).toBeNull(); expect(headers.get("x-status-token")).toBeNull();
    }
    const adapter = new SupabaseStorage(config(fake)); const before = fake.requests.length;
    for (const key of ["/absolute", "proofs/../x.jpg", "proofs/%2f/x.jpg", "banners/x.pdf", "https://evil.test/x", "tickets\\x.pdf", `banners/${randomUUID()}.jpg`]) await expect(adapter.getObject(key)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(fake.requests.length).toBe(before);
    const key = `proofs/${randomUUID()}/${randomUUID()}.jpg`;
    const url = new URL(await adapter.createSignedUrl(key, 9999), "https://app.example.test");
    expect(url.pathname).toBe("/api/admin/storage/object"); expect(Number(url.searchParams.get("exp")) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(90);
    const signed = signStoragePath(key, 90); expect(verifyStorageSignature(key, signed.exp, signed.sig).ok).toBe(true);
    expect(verifyStorageSignature(key, signed.exp + 1, signed.sig).ok).toBe(false);
    expect(verifyStorageSignature(key, ...[0, signed.sig] as const).ok).toBe(false);
  } finally { fake.server.stop(true); }
});
test("no-overwrite images; concurrent PDFs keep first bytes and verify input/hash/type metadata", async () => {
  const fake = startFakeStorage();
  try {
    const adapter = new SupabaseStorage(config(fake));
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).jpeg().toBuffer();
    const image = `proofs/${randomUUID()}/${randomUUID()}.jpg`;
    await adapter.putObject(image, jpeg, "image/jpeg"); await expect(adapter.putObject(image, jpeg, "image/jpeg")).rejects.toBeInstanceOf(StorageCollisionError);
    const key = pdfKey(); const variants = [pdf, Buffer.concat([pdf, Buffer.from("other timestamp")])];
    await Promise.all(variants.map(bytes => adapter.putObject(key, bytes, "application/pdf")));
    const stored = fake.objects.get(`sr-private/${key}`)!;
    expect(variants.some(bytes => Buffer.from(stored.bytes).equals(bytes))).toBe(true);
    expect((await adapter.getObject(key))?.bytes).toEqual(stored.bytes);
    stored.metadata.input_hash = "b".repeat(64);
    await expect(adapter.putObject(key, pdf, "application/pdf")).rejects.toMatchObject({ code: "COLLISION_METADATA" });
    await expect(adapter.getObject(key)).rejects.toMatchObject({ code: "COLLISION_METADATA" });
  } finally { fake.server.stop(true); }
});
test("only verified object absence is null; auth/throttle/outage/redirect/malformed/oversized bodies and deadlines fail closed", async () => {
  const fake = startFakeStorage();
  try {
    const adapter = new SupabaseStorage({ ...config(fake), timeoutMs: 80 }); const key = pdfKey();
    expect(await adapter.getObject(key)).toBeNull();
    for (const active of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { status: 404, code: "NoSuchBucket" }, { status: 400, malformed: true }, { size: PDF_OBJECT_BYTES + 1 }, { delay: 200 }]) {
      await fault(fake, { operation: "authenticated", ...active, once: true });
      await expect(adapter.getObject(key)).rejects.toBeInstanceOf(StorageUnavailableError);
    }
    const redirects = new SupabaseStorage({ ...config(fake), fetch: (async () => new Response(null, { status: 302 })) as typeof fetch });
    await expect(redirects.getObject(key)).rejects.toBeInstanceOf(StorageUnavailableError);
    const badType = new SupabaseStorage({ ...config(fake), fetch: (async () => new Response(pdf, { headers: { "content-type": "text/html" } })) as typeof fetch });
    await expect(badType.getObject(key)).rejects.toMatchObject({ code: "TYPE" });
    await expect(adapter.putObject(key, new Uint8Array(PDF_OBJECT_BYTES + 1), "application/pdf")).rejects.toBeInstanceOf(StorageUnavailableError);
  } finally { fake.server.stop(true); }
});
