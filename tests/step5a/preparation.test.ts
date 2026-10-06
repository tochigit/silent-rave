import { test, expect } from "bun:test";
import { prepareImage } from "@/lib/uploads/prepare-image";
import { uploadFailure } from "@/lib/uploads/messages";
import { IMAGE_FILE_BYTES, ORIGINAL_IMAGE_BYTES } from "@/lib/uploads/limits";
import "../phase3b/load-env";

test("browser preparation bounds retries, uses white JPEG and releases URLs; HEIC/no-canvas/too-large failures never upload", async () => {
  const saved = { Image: globalThis.Image, document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let rounds = 0; let revoked = 0; let decodeFailure = false; let canvasFailure = false; let alwaysLarge = false;
  const paints: string[] = [];
  try {
    URL.createObjectURL = () => "blob:fixture"; URL.revokeObjectURL = () => { revoked++; };
    globalThis.Image = class { naturalWidth = 3600; naturalHeight = 2400; src = ""; decode() { return decodeFailure ? Promise.reject(new Error()) : Promise.resolve(); } } as unknown as typeof Image;
    const context = { fillStyle: "", fillRect() { paints.push(this.fillStyle); }, drawImage() {} };
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => canvasFailure ? null : context, toBlob(callback: BlobCallback, type: string) { rounds++; callback(new Blob([new Uint8Array(alwaysLarge || rounds < 3 ? IMAGE_FILE_BYTES + 1 : 100)], { type })); } }) } as unknown as Document;
    const prepared = await prepareImage(new File(["receipt"], "receipt.jpg", { type: "image/jpeg" }));
    expect(rounds).toBe(3); expect(prepared.type).toBe("image/jpeg"); expect(prepared.size).toBe(100); expect(paints.every(p => p === "#fff")).toBe(true); expect(revoked).toBe(1);
    rounds = 0; alwaysLarge = true; await expect(prepareImage(new File(["x"], "x.png", { type: "image/png" }))).rejects.toThrow("3 MiB"); expect(rounds).toBe(4);
    decodeFailure = true; await expect(prepareImage(new File(["x"], "x.heic", { type: "image/heic" }))).rejects.toThrow("No image was uploaded");
    decodeFailure = false; canvasFailure = true; await expect(prepareImage(new File(["x"], "x.jpg", { type: "image/jpeg" }))).rejects.toThrow("3 MiB");
    const before = revoked; await expect(prepareImage(new File([new Uint8Array(ORIGINAL_IMAGE_BYTES + 1)], "huge.jpg", { type: "image/jpeg" }))).rejects.toThrow("25 MiB"); expect(revoked).toBe(before);
    expect(uploadFailure(413)).toContain("3 MiB"); expect(uploadFailure(413)).toContain("fields are saved"); expect(uploadFailure(503)).toContain("temporarily unavailable");
  } finally { globalThis.Image = saved.Image; globalThis.document = saved.document; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke; }
});
