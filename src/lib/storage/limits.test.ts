import { describe, expect, it } from "vitest";

import {
  MAX_IMAGES_PER_SUBMISSION,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  validateUpload,
} from "./limits";

const MB = 1024 * 1024;

describe("validateUpload", () => {
  it("accepts a PDF up to 20 MB", () => {
    expect(validateUpload({ mime: "application/pdf", size: 20 * MB })).toEqual({ ok: true });
  });

  it("rejects a PDF over 20 MB", () => {
    const result = validateUpload({ mime: "application/pdf", size: 20 * MB + 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("20 MB");
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s up to 10 MB", (mime) => {
    expect(validateUpload({ mime, size: 10 * MB })).toEqual({ ok: true });
  });

  it("rejects an image over 10 MB", () => {
    const result = validateUpload({ mime: "image/jpeg", size: 10 * MB + 1 });

    expect(result.ok).toBe(false);
  });

  it("rejects a HEIC photo with a message that says what to do", () => {
    const result = validateUpload({ mime: "image/heic", size: MB });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/JPEG|PNG|WebP/);
  });

  it("rejects an empty file and a non-integer size", () => {
    expect(validateUpload({ mime: "application/pdf", size: 0 }).ok).toBe(false);
    expect(validateUpload({ mime: "application/pdf", size: 1.5 }).ok).toBe(false);
  });

  it("exposes the limits from the spec", () => {
    expect(MAX_PDF_BYTES).toBe(20 * MB);
    expect(MAX_IMAGE_BYTES).toBe(10 * MB);
    expect(MAX_IMAGES_PER_SUBMISSION).toBe(10);
  });
});
