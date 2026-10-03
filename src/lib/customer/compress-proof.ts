/** Native browser decoding also converts HEIC on browsers that support it. No remote upload/converter. */
export async function compressProof(file: File): Promise<File> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Choose an image smaller than 25 MB before compression.");
  const heic =
    /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
  if (
    !heic &&
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
    !/\.(jpe?g|png|webp)$/i.test(file.name)
  )
    throw new Error(
      "Choose a JPEG, PNG or WebP image. HEIC can be converted only when this browser supports it.",
    );
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(
        heic
          ? "This browser cannot convert HEIC. Export your receipt as JPEG or PNG in Photos, then choose that file. No receipt was uploaded."
          : "This image could not be read. Choose a JPEG, PNG or WebP receipt.",
      );
    }
    const scale = Math.min(
      1,
      2400 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error(
        "Image conversion is unavailable. Choose a JPEG or PNG under 4 MB.",
      );
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not compress the image.")),
        "image/jpeg",
        0.86,
      ),
    );
    if (blob.size > 4 * 1024 * 1024)
      throw new Error(
        "The compressed image is still larger than 4 MB. Choose a smaller image.",
      );
    return new File([blob], "receipt.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
