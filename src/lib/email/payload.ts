import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { emailConfig } from "./config";
import type { EmailPayload } from "./transport";

export function sealPayload(jobId: string, payload: EmailPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", emailConfig().payloadKey, iv);
  cipher.setAAD(Buffer.from(jobId));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64url");
}
export function openPayload(jobId: string, sealed: string): EmailPayload {
  const bytes = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", emailConfig().payloadKey, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(jobId)); decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}
