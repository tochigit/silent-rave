import { createHmac, timingSafeEqual } from "node:crypto";
import { objectContract } from "./keys";
import { StorageUnavailableError } from "./errors";
const route = "/api/admin/storage/object";
function hmac(key: string, exp: number): Buffer {
  const secret = process.env.STORAGE_SIGNING_SECRET;
  if (!secret || secret.length < 16) throw new StorageUnavailableError("CONFIG");
  return createHmac("sha256", secret).update(`${key}:${exp}`).digest();
}
export type StorageSignature = { key: string; exp: number; sig: string };
export function signStoragePath(key: string, ttlSeconds: number): StorageSignature {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { key, exp, sig: hmac(key, exp).toString("base64url") };
}
export type StorageSignatureCheck = { ok: true } | { ok: false; reason: "malformed" | "expired" | "bad_signature" };
export function verifyStorageSignature(key: string, exp: number, sig: string): StorageSignatureCheck {
  if (!Number.isSafeInteger(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return { ok: false, reason: "malformed" };
  const now = Math.floor(Date.now() / 1000);
  if (exp <= now) return { ok: false, reason: "expired" };
  if (exp > now + 120) return { ok: false, reason: "malformed" };
  const expected = hmac(key, exp); const presented = Buffer.from(sig, "base64url");
  return presented.length === expected.length && timingSafeEqual(expected, presented) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
export function applicationSignedUrl(key: string): string {
  if (objectContract(key).kind !== "PROOF") throw new StorageUnavailableError("KEY");
  const signed = signStoragePath(key, 90);
  return `${route}?${new URLSearchParams({ key: signed.key, exp: String(signed.exp), sig: signed.sig })}`;
}
