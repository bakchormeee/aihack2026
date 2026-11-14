// Phone photos are resized in the browser before upload so they stay within
// the AI image limits (SPEC.md, `sheets`). Frozen after task F5.

export const MAX_LONG_EDGE = 2000;

export function targetSize(
  width: number,
  height: number,
): { width: number; height: number; resized: boolean } {
  if (!(width > 0) || !(height > 0)) throw new Error("Image size must be positive");
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE) return { width, height, resized: false };

  const scale = MAX_LONG_EDGE / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/** Browser only. Returns a JPEG no larger than MAX_LONG_EDGE on its long side. PDFs are not passed here. */
export async function resizeImageToJpeg(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = targetSize(bitmap.width, bitmap.height);
    if (!size.resized && file.type === "image/jpeg") return file;

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("Could not prepare the image");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
