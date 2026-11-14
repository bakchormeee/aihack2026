// Upload limits from SPEC.md (`sheets`). Frozen after task F5.

const MB = 1024 * 1024;

export const MAX_PDF_BYTES = 20 * MB;
export const MAX_IMAGE_BYTES = 10 * MB;
/** Images attached to one submission. */
export const MAX_IMAGES_PER_SUBMISSION = 10;
/** Images in one sheet or official-solutions upload. */
export const MAX_IMAGES_PER_SHEET_UPLOAD = 10;

export const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_MIMES = ["application/pdf", ...ACCEPTED_IMAGE_MIMES] as const;

export type UploadCheck = { ok: true } | { ok: false; message: string };

export function validateUpload(i: { mime: string; size: number }): UploadCheck {
  if (!Number.isInteger(i.size) || i.size <= 0) return { ok: false, message: "The file is empty." };

  if (i.mime === "application/pdf") {
    return i.size <= MAX_PDF_BYTES
      ? { ok: true }
      : { ok: false, message: "A PDF can be at most 20 MB." };
  }
  if ((ACCEPTED_IMAGE_MIMES as readonly string[]).includes(i.mime)) {
    return i.size <= MAX_IMAGE_BYTES
      ? { ok: true }
      : { ok: false, message: "An image can be at most 10 MB." };
  }
  return { ok: false, message: "Use a PDF, or a JPEG, PNG or WebP image." };
}
