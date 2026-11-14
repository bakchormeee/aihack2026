// Builds the hand-in PDF from working that the browser has already fetched
// (and, for typed working, drawn as an image). Pure apart from pdf-lib.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { pdfSafeText } from "./hand-in";

export type ResolvedPage =
  | {
      kind: "image";
      label: string;
      continued: boolean;
      bytes: Uint8Array;
      mime: "image/jpeg" | "image/png";
    }
  | { kind: "pdf"; label: string; continued: boolean; bytes: Uint8Array }
  | { kind: "notAttempted"; labels: string[] };

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const HEADER = 28;

/** Largest size that fits the box without enlarging, centred in it. */
export function fitInside(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  const w = width * scale;
  const h = height * scale;
  return { width: w, height: h, x: (boxWidth - w) / 2, y: (boxHeight - h) / 2 };
}

const heading = (label: string, continued: boolean) =>
  pdfSafeText(`Question ${label}${continued ? " (continued)" : ""}`);

export async function buildHandInPdf(pages: ResolvedPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const page of pages) {
    if (page.kind === "image") {
      const image =
        page.mime === "image/png" ? await doc.embedPng(page.bytes) : await doc.embedJpg(page.bytes);
      const sheet = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      sheet.drawText(heading(page.label, page.continued), {
        x: MARGIN,
        y: PAGE_HEIGHT - MARGIN,
        size: 14,
        font: bold,
      });
      const boxWidth = PAGE_WIDTH - 2 * MARGIN;
      const boxHeight = PAGE_HEIGHT - 2 * MARGIN - HEADER;
      const fit = fitInside(image.width, image.height, boxWidth, boxHeight);
      // Anchor to the top of the box so short images sit under the heading.
      sheet.drawImage(image, {
        x: MARGIN + fit.x,
        y: MARGIN + boxHeight - fit.height,
        width: fit.width,
        height: fit.height,
      });
    } else if (page.kind === "pdf") {
      const source = await PDFDocument.load(page.bytes);
      const copied = await doc.copyPages(source, source.getPageIndices());
      copied.forEach((copy, index) => {
        doc.addPage(copy);
        copy.drawText(heading(page.label, page.continued || index > 0), {
          x: 12,
          y: copy.getHeight() - 14,
          size: 9,
          font: bold,
          color: rgb(0.2, 0.2, 0.2),
        });
      });
    } else {
      const sheet = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      sheet.drawText("Not attempted", { x: MARGIN, y: PAGE_HEIGHT - MARGIN, size: 14, font: bold });
      page.labels.forEach((label, index) => {
        sheet.drawText(pdfSafeText(`Question ${label}`), {
          x: MARGIN,
          y: PAGE_HEIGHT - MARGIN - HEADER - index * 18,
          size: 12,
          font,
        });
      });
    }
  }
  return doc.save();
}
