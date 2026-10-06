import { createHash } from "node:crypto";
import { boundedBytes, UploadError } from "@/lib/uploads/multipart";
import { StorageCollisionError, StorageUnavailableError } from "./errors";
import { objectContract, validObject } from "./keys";
import { applicationSignedUrl } from "./signatures";
import type { StorageAdapter, StoredObject, PutResult } from "./types";

type Config = { url: string; serverKey: string; privateBucket?: string; bannerBucket?: string; fetch?: typeof fetch; timeoutMs?: number };
type Reply = { status: number; contentType: string; bytes: Buffer };
function json(reply: Reply): Record<string, unknown> {
  try {
    if (reply.contentType !== "application/json") throw new Error();
    const result = JSON.parse(reply.bytes.toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new StorageUnavailableError("PROVIDER"); }
}
function errorCode(reply: Reply): string { const value = json(reply); return String(value.code ?? value.error ?? ""); }
function notFound(reply: Reply): boolean {
  return [400, 404].includes(reply.status) && ["NoSuchKey", "NoSuchObject", "not_found", "Object not found"].includes(errorCode(reply));
}
function collision(reply: Reply): boolean {
  return [400, 409].includes(reply.status) && ["Duplicate", "ResourceAlreadyExists", "KeyAlreadyExists"].includes(errorCode(reply));
}

/** REST only. No browser SDK, bearer signed URLs, redirects or local fallback. */
export class SupabaseStorage implements StorageAdapter {
  readonly driver = "supabase";
  private readonly origin: string;
  private readonly headers: Record<string, string>;
  private readonly privateBucket: string;
  private readonly bannerBucket: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  constructor(config: Config = { url: process.env.SUPABASE_URL ?? "", serverKey: process.env.SUPABASE_STORAGE_SERVER_KEY ?? "", privateBucket: process.env.SR_PRIVATE_BUCKET, bannerBucket: process.env.SR_BANNER_BUCKET }) {
    let url: URL;
    try { url = new URL(config.url); } catch { throw new StorageUnavailableError("CONFIG"); }
    const localFixture = process.env.SILENT_RAVE_ISOLATED_FIXTURE === "1" && process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "127.0.0.1";
    if ((!localFixture && (url.protocol !== "https:" || url.port)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new StorageUnavailableError("CONFIG");
    this.origin = url.origin;
    this.headers = { apikey: config.serverKey };
    if (/^sb_secret_[A-Za-z0-9_-]+$/.test(config.serverKey)) { /* This key is not a bearer JWT. */ }
    else {
      try {
        const parts = config.serverKey.split(".");
        if (parts.length !== 3 || JSON.parse(Buffer.from(parts[1], "base64url").toString()).role !== "service_role" || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
        this.headers.Authorization = `Bearer ${config.serverKey}`;
      } catch { throw new StorageUnavailableError("CONFIG"); }
    }
    this.privateBucket = config.privateBucket ?? "sr-private";
    this.bannerBucket = config.bannerBucket ?? "sr-banners";
    if (this.privateBucket === this.bannerBucket || ![this.privateBucket, this.bannerBucket].every(b => /^[a-z0-9][a-z0-9-]{0,62}$/.test(b))) throw new StorageUnavailableError("CONFIG");
    this.fetcher = config.fetch ?? fetch;
    this.timeoutMs = Math.min(config.timeoutMs ?? 5000, 5000);
  }
  private path(key: string): string {
    const contract = objectContract(key);
    const bucket = contract.kind === "BANNER" ? this.bannerBucket : this.privateBucket;
    return [bucket, ...key.split("/")].map(encodeURIComponent).join("/");
  }
  private async operation(path: string, method: "POST" | "GET", limit: number, body?: Uint8Array, headers: Record<string, string> = {}): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.origin}/storage/v1/${path}`, { method, headers: { ...this.headers, ...headers }, body: body ? new Uint8Array(body) : undefined, signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store" });
      const bytes = await boundedBytes(response.body, response.ok ? limit : 8192, response.headers.get("content-length"), this.timeoutMs);
      return { status: response.status, contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), bytes };
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError(controller.signal.aborted || (error instanceof UploadError && error.status === 408) ? "TIMEOUT" : error instanceof UploadError && error.status === 413 ? "SIZE" : "PROVIDER");
    } finally { clearTimeout(timer); }
  }
  private async pdfInfo(key: string): Promise<{ sha256: string; size: number }> {
    const reply = await this.operation(`object/info/${this.path(key)}`, "GET", 8192);
    if (reply.status !== 200) throw new StorageUnavailableError("COLLISION_METADATA");
    const info = json(reply);
    const metadata = info.metadata as Record<string, unknown> | undefined;
    const user = (info.user_metadata ?? (info.content_type ? metadata : undefined)) as Record<string, unknown> | undefined;
    const size = info.size ?? metadata?.size;
    if ((info.content_type ?? metadata?.mimetype) !== "application/pdf" || !Number.isSafeInteger(size) || Number(size) <= 0 || Number(size) > objectContract(key).limit || user?.input_hash !== objectContract(key).inputHash || typeof user.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(user.sha256)) throw new StorageUnavailableError("COLLISION_METADATA");
    return { sha256: user.sha256, size: Number(size) };
  }
  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<PutResult> {
    const contract = objectContract(key); const target = this.path(key);
    if (contentType !== contract.contentType || !validObject(bytes, contentType)) throw new StorageUnavailableError("TYPE");
    if (bytes.length > contract.limit) throw new StorageUnavailableError("SIZE");
    const metadata = { sha256: createHash("sha256").update(bytes).digest("hex"), ...(contract.inputHash ? { input_hash: contract.inputHash } : {}) };
    const reply = await this.operation(`object/${target}`, "POST", 8192, bytes, { "content-type": contentType, "x-upsert": "false", "cache-control": contract.kind === "BANNER" ? "max-age=3600" : "max-age=0", "x-metadata": Buffer.from(JSON.stringify(metadata)).toString("base64") });
    if (reply.status === 200 || reply.status === 201) {
      const result = json(reply);
      if (result.Key !== `${contract.kind === "BANNER" ? this.bannerBucket : this.privateBucket}/${key}`) throw new StorageUnavailableError("PROVIDER");
      return { storagePath: key };
    }
    if (collision(reply)) {
      if (contract.kind !== "PDF") throw new StorageCollisionError();
      await this.pdfInfo(key); // First stored artifact wins only for the same semantic input hash.
      return { storagePath: key };
    }
    throw new StorageUnavailableError("PROVIDER");
  }
  async getObject(key: string): Promise<StoredObject | null> {
    const contract = objectContract(key);
    const reply = await this.operation(`object/authenticated/${this.path(key)}`, "GET", contract.limit);
    if (notFound(reply)) return null;
    if (reply.status !== 200) throw new StorageUnavailableError("PROVIDER");
    if (reply.contentType !== contract.contentType || !validObject(reply.bytes, reply.contentType)) throw new StorageUnavailableError("TYPE");
    if (contract.kind === "PDF") {
      const info = await this.pdfInfo(key);
      if (info.size !== reply.bytes.length || info.sha256 !== createHash("sha256").update(reply.bytes).digest("hex")) throw new StorageUnavailableError("COLLISION_METADATA");
    }
    return { bytes: new Uint8Array(reply.bytes), contentType: contract.contentType };
  }
  async createSignedUrl(key: string, _ttlSeconds: number): Promise<string> { return applicationSignedUrl(key); }
}
