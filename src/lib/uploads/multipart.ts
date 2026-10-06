import { IMAGE_FILE_BYTES, MULTIPART_BYTES } from "./limits";

export class UploadError extends Error {
  constructor(public status: number, message: string, public code = "BAD_UPLOAD") { super(message); }
}

/** A single allocation, actual-byte ceiling and total read deadline; never trusts Content-Length. */
export async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number, declared: string | null, timeoutMs = 15_000): Promise<Buffer> {
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
    throw new UploadError(400, "Invalid upload length.");
  if (declared !== null && Number(declared) > limit) throw new UploadError(413, "Upload too large. Choose an image under 3 MiB.");
  if (!body) throw new UploadError(400, "Upload body required.");
  const reader = body.getReader();
  const bytes = Buffer.allocUnsafe(limit);
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new UploadError(408, "Upload timed out. Retry when connected.")); void reader.cancel().catch(() => {}); }, timeoutMs);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      if (size + part.value.byteLength > limit) {
        void reader.cancel().catch(() => {});
        throw new UploadError(413, "Upload too large. Choose an image under 3 MiB.");
      }
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    return bytes.subarray(0, size);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** Parse only the small named contract after bounding bytes; headers and parts are bounded too. */
export async function imageMultipart(request: Request, fileField: "proof" | "banner", fields: Record<string, number> = {}): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  const match = /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))$/i.exec(contentType);
  if (!match) throw new UploadError(400, "Expected a valid multipart/form-data upload.");
  const bytes = await boundedBytes(request.body, MULTIPART_BYTES, request.headers.get("content-length"));
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  const separator = Buffer.from(`\r\n${boundary.toString()}`);
  const form = new FormData();
  const seen = new Set<string>();
  let offset = 0;
  for (let parts = 0; parts <= Object.keys(fields).length + 1; parts++) {
    if (!bytes.subarray(offset, offset + boundary.length).equals(boundary)) throw new UploadError(400, "Could not parse the upload.");
    offset += boundary.length;
    if (bytes.subarray(offset, offset + 2).toString() === "--") {
      offset += 2;
      if (bytes.subarray(offset).length && bytes.subarray(offset).toString() !== "\r\n") throw new UploadError(400, "Unexpected upload data.");
      if (!seen.has(fileField)) throw new UploadError(422, `${fileField} (image file) is required.`, "BAD_FILE");
      return form;
    }
    if (bytes.subarray(offset, offset + 2).toString() !== "\r\n") throw new UploadError(400, "Could not parse the upload.");
    offset += 2;
    const endHeaders = bytes.indexOf("\r\n\r\n", offset);
    if (endHeaders < 0 || endHeaders - offset > 1024) throw new UploadError(400, "Upload metadata is too large.");
    const headerLines = bytes.subarray(offset, endHeaders).toString("utf8").split("\r\n");
    const disposition = /^Content-Disposition: form-data; name="([a-z_]{1,40})"(?:; filename="([^"\r\n\x00]{1,128})")?$/i.exec(headerLines[0]);
    if (!disposition || headerLines.length > 2 || (headerLines[1] && !/^Content-Type: [a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(headerLines[1])))
      throw new UploadError(400, "Invalid upload metadata.");
    const name = disposition[1]; const isFile = disposition[2] !== undefined;
    if (seen.has(name) || (name !== fileField && !Object.hasOwn(fields, name)) || isFile !== (name === fileField)) throw new UploadError(400, "Unexpected or repeated upload field.");
    seen.add(name);
    offset = endHeaders + 4;
    const endPart = bytes.indexOf(separator, offset);
    if (endPart < 0) throw new UploadError(400, "Could not parse the upload.");
    const value = bytes.subarray(offset, endPart);
    if (isFile) {
      if (value.length > IMAGE_FILE_BYTES) throw new UploadError(422, "Image must be at most 3 MiB.", "BAD_FILE");
      form.set(name, new File([new Uint8Array(value)], disposition[2], { type: headerLines[1]?.slice(14) ?? "application/octet-stream" }));
    } else {
      if (value.length > fields[name] * 4) throw new UploadError(400, "Upload field is too large.");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(value); }
      catch { throw new UploadError(400, "Invalid upload field encoding."); }
      if (text.length > fields[name]) throw new UploadError(400, "Upload field is too large.");
      form.set(name, text);
    }
    offset = endPart + 2;
  }
  throw new UploadError(400, "Too many upload fields.");
}
