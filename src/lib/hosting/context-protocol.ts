export const CONTEXT_HEADER = "x-sr-context";
export const SIGNATURE_HEADER = "x-sr-signature";
export const CONTEXT_TTL_MS = 30_000;
export type TrustedRequestContext = { hostname: string; origin: string; clientIp: string;
  method: string; originalPathname: string; deploymentId: string };
export type Envelope = TrustedRequestContext & { v: 1; issuedAt: number };
export const encoder = new TextEncoder();
export function validIp(value: string) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split(".").every(part => Number(part) <= 255);
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try { return new URL(`http://[${value}]/`).hostname.startsWith("["); } catch { return false; }
}
export function parseEnvelope(raw: string | null, expectedDeployment: string, now = Date.now()): Envelope {
  if (!raw || raw.length > 4096) throw new Error("Missing request context");
  const data = JSON.parse(raw) as Envelope;
  if (Object.keys(data).sort().join(",") !== "clientIp,deploymentId,hostname,issuedAt,method,origin,originalPathname,v" || data.v !== 1 ||
      data.deploymentId !== expectedDeployment || !Number.isSafeInteger(data.issuedAt) || data.issuedAt > now + 1000 || now - data.issuedAt > CONTEXT_TTL_MS ||
      ![data.hostname, data.origin, data.clientIp, data.method, data.originalPathname].every(v => typeof v === "string" && v.length > 0 && v.length <= 2048) ||
      !/^[A-Z]+$/.test(data.method) || !validIp(data.clientIp) || !data.originalPathname.startsWith("/") || /[\r\n\u0000]/.test(raw)) throw new Error("Invalid request context");
  const origin = new URL(data.origin);
  if (origin.origin !== data.origin || origin.hostname !== data.hostname) throw new Error("Invalid context origin");
  return data;
}
export function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
export function signatureBytes(signature: string | null): Uint8Array<ArrayBuffer> {
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) throw new Error("Invalid context signature");
  return Uint8Array.from(signature.match(/../g)!, part => parseInt(part, 16));
}
export async function hmacKey(secret: string | undefined, usage: KeyUsage[]) {
  if (!secret || secret.length < 32) throw new Error("Missing ingress key");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}
