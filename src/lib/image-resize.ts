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

/**
 * The pixel rectangle of a box given as fractions (0–1) of an image of this size:
 * whole pixels, inside the image, at least 1 pixel on each side.
 */
export function cropRect(
  box: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(width > 0) || !(height > 0)) throw new Error("Image size must be positive");
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const left = Math.round(clamp(box.x, 1) * width);
  const top = Math.round(clamp(box.y, 1) * height);
  const right = Math.round(clamp(box.x + box.w, 1) * width);
  const bottom = Math.round(clamp(box.y + box.h, 1) * height);
  const sx = Math.min(left, width - 1);
  const sy = Math.min(top, height - 1);
  return { sx, sy, sw: Math.max(1, right - sx), sh: Math.max(1, bottom - sy) };
}

/**
 * Browser only. Cuts the box (fractions of the photo) out of the photo, as a JPEG at
 * the photo's own resolution (the photo was already resized for upload).
 */
export async function cropImage(
  photo: Blob,
  box: { x: number; y: number; w: number; h: number },
  name: string,
): Promise<File> {
  const bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  try {
    const { sx, sy, sw, sh } = cropRect(box, bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, sw, sh);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) throw new Error("Could not prepare the image");
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
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
