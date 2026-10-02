import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PutResult, StorageAdapter, StoredObject } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Local-disk storage driver (DEV FIXTURE ONLY — production uses Supabase
// Storage, see ./supabase.ts).
//
//   • Objects live under LOCAL_STORAGE_DIR (default ./.storage-local —
//     gitignored, never inside public/), written with 0600 permissions.
//   • Keys are server-generated ("proofs/<order_id>/<attempt>-<uuid>.jpg") and
//     sanitized against traversal; storage paths are opaque to clients.
//   • "Signed URLs" are HMAC-SHA256-signed query params:
//         /api/admin/storage/object?key=<path>&exp=<epochSec>&sig=<base64url>
//     where sig = HMAC(STORAGE_SIGNING_SECRET, path ":" exp). The serving
//     route additionally requires an OWNER session — signature AND authz AND
//     expiry all have to pass, so a leaked URL alone (or an OWNER session
//     alone) is not enough. TTL is enforced server-side at read time.
// ─────────────────────────────────────────────────────────────────────────────

const SIGNED_URL_ROUTE = "/api/admin/storage/object";

function storageRoot(): string {
  return process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".storage-local");
}

function getSigningSecret(): Buffer {
  const raw = process.env.STORAGE_SIGNING_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "STORAGE_SIGNING_SECRET is unset or too short (<16 chars) — refusing to sign storage URLs. Set it in the environment (see .env.example)."
    );
  }
  return Buffer.from(raw, "utf8");
}

/** Resolve a storage key to an absolute path, rejecting traversal/absolute keys. */
function resolveSafe(key: string): string {
  if (!key || key.includes("\0")) throw new Error("invalid storage key");
  const normalized = path.posix.normalize(key.replace(/\\/g, "/"));
  if (normalized.startsWith("/") || normalized.startsWith("..") || path.posix.isAbsolute(normalized)) {
    throw new Error("invalid storage key");
  }
  return path.join(storageRoot(), normalized);
}

function hmac(pathname: string, expSeconds: number): Buffer {
  return createHmac("sha256", getSigningSecret()).update(`${pathname}:${expSeconds}`).digest();
}

export type StorageSignature = { key: string; exp: number; sig: string };

/** Sign a storage path for ttlSeconds (used by createSignedUrl + tests). */
export function signStoragePath(storagePath: string, ttlSeconds: number): StorageSignature {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = hmac(storagePath, exp).toString("base64url");
  return { key: storagePath, exp, sig };
}

export type StorageSignatureCheck =
  | { ok: true }
  | { ok: false; reason: "malformed" | "expired" | "bad_signature" };

/** Verify a presented (key, exp, sig) triple — constant-time on the digest. */
export function verifyStorageSignature(
  storagePath: string,
  expSeconds: number,
  presentedSig: string
): StorageSignatureCheck {
  if (!Number.isInteger(expSeconds)) return { ok: false, reason: "malformed" };
  if (expSeconds <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  const expected = hmac(storagePath, expSeconds);
  let given: Buffer;
  try {
    given = Buffer.from(presentedSig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || expected.length === 0) {
    return { ok: false, reason: "bad_signature" };
  }
  if (!timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

export class LocalDiskStorage implements StorageAdapter {
  readonly driver = "local";

  async putObject(key: string, bytes: Uint8Array, _contentType: string): Promise<PutResult> {
    const absolute = resolveSafe(key);
    await mkdir(path.dirname(absolute), { recursive: true });
    // 0600 — private to the server process; the directory itself is never
    // served by any static file route (it sits outside public/).
    await writeFile(absolute, bytes, { mode: 0o600 });
    return { storagePath: key };
  }

  async getObject(storagePath: string): Promise<StoredObject | null> {
    let absolute: string;
    try {
      absolute = resolveSafe(storagePath);
    } catch {
      return null;
    }
    try {
      await stat(absolute); // throws for missing paths → null
    } catch {
      return null;
    }
    const bytes = await readFile(absolute);
    // Re-encoded server-side as JPEG (see the proof pipeline); the manifest
    // of stored types is tracked per-object by callers when it matters.
    const contentType = storagePath.endsWith(".pdf") ? "application/pdf" : storagePath.endsWith(".png")
      ? "image/png"
      : storagePath.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { bytes: new Uint8Array(bytes), contentType };
  }

  async createSignedUrl(storagePath: string, ttlSeconds: number): Promise<string> {
    const { key, exp, sig } = signStoragePath(storagePath, ttlSeconds);
    const params = new URLSearchParams({ key, exp: String(exp), sig });
    return `${SIGNED_URL_ROUTE}?${params.toString()}`;
  }
}
