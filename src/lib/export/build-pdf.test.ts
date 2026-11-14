import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildHandInPdf, fitInside, type ResolvedPage } from "./build-pdf";

// A 1x1 PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([300, 400]);
  return doc.save();
}

describe("fitInside", () => {
  it("scales down to fit and centres, never scaling up past the box", () => {
    expect(fitInside(1000, 500, 200, 200)).toEqual({ width: 200, height: 100, x: 0, y: 50 });
    expect(fitInside(50, 50, 200, 200)).toEqual({ width: 50, height: 50, x: 75, y: 75 });
  });
});

describe("buildHandInPdf", () => {
  it("builds one page per photo, merges a PDF's pages and adds a not-attempted page", async () => {
    const pages: ResolvedPage[] = [
      { kind: "image", label: "1", continued: false, bytes: PNG, mime: "image/png" },
      { kind: "image", label: "1", continued: true, bytes: PNG, mime: "image/png" },
      { kind: "pdf", label: "2", continued: false, bytes: await pdfWithPages(3) },
      { kind: "notAttempted", labels: ["3", "4"] },
    ];

    const bytes = await buildHandInPdf(pages);

    const result = await PDFDocument.load(bytes);
    expect(result.getPageCount()).toBe(2 + 3 + 1);
  });

  it("produces a valid PDF file even with no pages", async () => {
    const bytes = await buildHandInPdf([]);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("rejects an unreadable PDF rather than silently dropping it", async () => {
    await expect(
      buildHandInPdf([
        { kind: "pdf", label: "1", continued: false, bytes: new Uint8Array([1, 2, 3]) },
      ]),
    ).rejects.toThrow();
  });
});
