import { test, expect } from "bun:test";
import sharp from "sharp";
import { IMAGE_FILE_BYTES, MULTIPART_BYTES } from "@/lib/uploads/limits";
import { boundedBytes, imageMultipart } from "@/lib/uploads/multipart";
import { sanitizeImage } from "@/lib/uploads/sanitize";
import "../phase3b/load-env";

function stream(bytes: Uint8Array) { return new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 8192) c.enqueue(bytes.subarray(i, i + 8192)); c.close(); } }); }
function multipart(fileSize = 16) {
  const form = new FormData(); form.set("proof", new File([new Uint8Array(fileSize)], "receipt.jpg", { type: "image/jpeg" }));
  form.set("sender_name", "Chloé Ọlá"); form.set("transfer_reference", "abc"); form.set("client_submission_id", "retry-id");
  return form;
}
const parse = (form: FormData) => imageMultipart(new Request("http://127.0.0.1/upload", { method: "POST", body: form }), "proof", { sender_name: 200, transfer_reference: 128, client_submission_id: 128 });
test("actual and declared envelopes accept the exact ceiling; cap+1 and forged/missing lengths stop before parsing", async () => {
  for (const declared of [null, "0", String(MULTIPART_BYTES)]) expect((await boundedBytes(stream(new Uint8Array(MULTIPART_BYTES)), MULTIPART_BYTES, declared)).length).toBe(MULTIPART_BYTES);
  for (const declared of [null, "1", String(MULTIPART_BYTES + 1)]) await expect(boundedBytes(stream(new Uint8Array(MULTIPART_BYTES + 1)), MULTIPART_BYTES, declared)).rejects.toMatchObject({ status: 413 });
  for (const declared of ["-1", "1.0", "NaN", "1e8"]) await expect(boundedBytes(stream(new Uint8Array(1)), MULTIPART_BYTES, declared)).rejects.toMatchObject({ status: 400 });
});
test("3 MiB file accepted; +1, duplicate files, oversized fields/filename, unknown parts and malformed boundaries refuse", async () => {
  expect((await parse(multipart(IMAGE_FILE_BYTES))).get("proof")).toBeInstanceOf(File);
  await expect(parse(multipart(IMAGE_FILE_BYTES + 1))).rejects.toMatchObject({ status: 422, code: "BAD_FILE" });
  const duplicate = multipart(); duplicate.append("proof", new File(["x"], "second.jpg")); await expect(parse(duplicate)).rejects.toMatchObject({ status: 400 });
  const extra = multipart(); extra.append("arbitrary", "x"); await expect(parse(extra)).rejects.toMatchObject({ status: 400 });
  const field = multipart(); field.set("sender_name", "x".repeat(201)); await expect(parse(field)).rejects.toMatchObject({ status: 400 });
  const filename = multipart(); filename.set("proof", new File(["x"], "x".repeat(129))); await expect(parse(filename)).rejects.toMatchObject({ status: 400 });
  await expect(imageMultipart(new Request("http://127.0.0.1", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=bad" }, body: "--bad\r\n" }), "banner")).rejects.toMatchObject({ status: 400 });
});
test("stalled reads have a total deadline and cancel the source", async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await expect(boundedBytes(source, 100, null, 20)).rejects.toMatchObject({ status: 408 }); expect(cancelled).toBe(true);
});
test("real sanitation orients EXIF, drops GPS/EXIF/XMP, flattens and caps stored bytes/dimensions", async () => {
  const original = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#ff0088" } }).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "Private" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "6/1 30/1 0/1" } }).toBuffer();
  for (const kind of ["proof", "banner"] as const) {
    const output = await sanitizeImage(original, kind); const meta = await sharp(output).metadata();
    expect(output.length).toBeLessThanOrEqual(IMAGE_FILE_BYTES); expect(meta.height).toBeGreaterThan(meta.width!);
    expect(meta.exif).toBeUndefined(); expect(meta.xmp).toBeUndefined(); expect(meta.orientation).toBeUndefined();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(kind === "proof" ? 2400 : 1600);
  }
  await expect(sanitizeImage(Buffer.from("fake jpeg"), "proof")).rejects.toThrow();
  const oversized = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "red" } }).png().toBuffer();
  await expect(sanitizeImage(oversized, "banner")).rejects.toThrow();
});
