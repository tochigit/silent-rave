import { IMAGE_FILE_BYTES, PDF_OBJECT_BYTES } from "@/lib/uploads/limits";
import { StorageUnavailableError } from "./errors";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const proof = new RegExp(`^proofs/${uuid}/${uuid}\\.jpg$`);
const ticket = new RegExp(`^tickets/${uuid}/([0-9a-f]{64})\\.pdf$`);
const banner = new RegExp(`^banners/${uuid}\\.webp$`);
export function objectContract(key: string) {
  if (proof.test(key)) return { kind: "PROOF" as const, contentType: "image/jpeg", limit: IMAGE_FILE_BYTES, inputHash: null };
  const pdf = ticket.exec(key);
  if (pdf) return { kind: "PDF" as const, contentType: "application/pdf", limit: PDF_OBJECT_BYTES, inputHash: pdf[1] };
  if (banner.test(key)) return { kind: "BANNER" as const, contentType: "image/webp", limit: IMAGE_FILE_BYTES, inputHash: null };
  throw new StorageUnavailableError("KEY");
}
export function validObject(bytes: Uint8Array, contentType: string) {
  if (!bytes.length) return false;
  const start = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  return contentType === "application/pdf" ? start.subarray(0, 5).toString() === "%PDF-"
    : contentType === "image/jpeg" ? start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff
    : contentType === "image/webp" && start.subarray(0, 4).toString() === "RIFF" && start.subarray(8, 12).toString() === "WEBP";
}
