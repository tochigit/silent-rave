import sharp from "sharp";
import { IMAGE_FILE_BYTES } from "./limits";

/** Bakes orientation, strips all metadata and bounds both decoded pixels and re-encoded output. */
export async function sanitizeImage(bytes: Buffer, kind: "proof" | "banner"): Promise<Buffer> {
  const image = sharp(bytes, { failOn: "error", limitInputPixels: kind === "proof" ? 100_000_000 : 24_000_000 });
  const meta = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1) throw new Error("INVALID_IMAGE");
  const maxDimension = kind === "proof" ? 2400 : 1600;
  for (const [scale, quality] of [[1, 85], [1, 72], [0.85, 70], [0.7, 65]] as const) {
    const pipeline = image.clone().rotate().flatten({ background: "#ffffff" }).resize({ width: Math.round(maxDimension * scale), height: Math.round(maxDimension * scale), fit: "inside", withoutEnlargement: true });
    const output = await (kind === "proof" ? pipeline.jpeg({ quality }) : pipeline.webp({ quality })).toBuffer();
    if (output.length <= IMAGE_FILE_BYTES) return output;
  }
  throw new Error("IMAGE_OUTPUT_TOO_LARGE");
}

