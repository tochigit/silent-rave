import { IMAGE_FILE_BYTES, ORIGINAL_IMAGE_BYTES } from "./limits";

/** Native decoding keeps HEIC conversion local on browsers that support it. */
export async function prepareImage(file: File, kind: "proof" | "banner" = "proof"): Promise<File> {
  if (file.size > ORIGINAL_IMAGE_BYTES) throw new Error("Choose an image smaller than 25 MiB before compression.");
  const heic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
  if (!heic && !["image/jpeg", "image/png", "image/webp"].includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name))
    throw new Error("Choose a JPEG, PNG or WebP image. HEIC conversion depends on your browser.");
  const url = URL.createObjectURL(file);
  const img = new Image();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    img.src = url;
    try {
      await Promise.race([img.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 15_000); })]);
    } catch {
      throw new Error(heic
        ? "This browser cannot convert HEIC. Export your image as JPEG or PNG in Photos, then choose that file. No image was uploaded."
        : "This image could not be read. Choose a JPEG, PNG or WebP image.");
    } finally { clearTimeout(timer); }
    if (!img.naturalWidth || !img.naturalHeight) throw new Error("This image could not be read.");
    const maxDimension = kind === "proof" ? 2400 : 1600;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image conversion is unavailable. Choose a JPEG or PNG under 3 MiB.");
    for (const [resize, quality] of [[1, 0.86], [1, 0.74], [0.85, 0.72], [0.7, 0.68]] as const) {
      const scale = Math.min(1, maxDimension * resize / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not compress the image.")), "image/jpeg", quality));
      if (blob.type !== "image/jpeg") throw new Error("Image conversion is unavailable. Choose a JPEG under 3 MiB.");
      if (blob.size <= IMAGE_FILE_BYTES) return new File([blob], kind === "proof" ? "receipt.jpg" : "banner.jpg", { type: "image/jpeg" });
    }
    throw new Error("The prepared image is still larger than 3 MiB. Choose a smaller image; nothing was uploaded.");
  } finally { URL.revokeObjectURL(url); }
}
