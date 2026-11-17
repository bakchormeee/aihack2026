// The file checks shared by both providers: which files can be sent, and how large.

import { AiInputError } from "./errors";

export type AiFile = { mime: string; data: Buffer };

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

/** A file that passed the checks, already base64-encoded for the request. */
export type PreparedFile =
  | { kind: "pdf"; mime: "application/pdf"; base64: string }
  | { kind: "image"; mime: ImageMime; base64: string };

/** Anthropic limit: 10 MB for each image, measured on the base64 text. OpenAI allows more. */
const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
/** Our own limit for one PDF (SPEC: uploads up to 20 MB). Both APIs allow more. */
const MAX_PDF_BYTES = 32 * 1024 * 1024;

export function prepareFile(file: AiFile): PreparedFile {
  if (file.mime === "application/pdf") {
    if (file.data.length > MAX_PDF_BYTES) {
      throw new AiInputError("PDF is larger than 32 MB and cannot be sent to the AI.");
    }
    return { kind: "pdf", mime: "application/pdf", base64: file.data.toString("base64") };
  }
  if (IMAGE_MIMES.includes(file.mime as ImageMime)) {
    const base64 = file.data.toString("base64");
    if (base64.length > MAX_IMAGE_BASE64_BYTES) {
      throw new AiInputError("Image is larger than the 10 MB API limit; resize it before upload.");
    }
    return { kind: "image", mime: file.mime as ImageMime, base64 };
  }
  throw new AiInputError(`File type "${file.mime}" cannot be sent to the AI.`);
}
