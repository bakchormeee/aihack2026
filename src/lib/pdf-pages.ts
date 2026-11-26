// A PDF chosen in the batch upload becomes one JPEG per page, in the browser, and from
// then on the batch flow treats the pages exactly like photos (SPEC-study-views.md,
// `batch-pdf`). pdfjs-dist is loaded with a dynamic import() only when a PDF is
// rendered, so no other bundle grows. Pages are rendered one at a time.

import { MAX_LONG_EDGE } from "./image-resize";
import { MAX_IMAGES_PER_SHEET_UPLOAD } from "./storage/limits";

export const MAX_PDF_PAGES = 10;

const PASSWORD_MESSAGE = "This PDF is password-protected. Remove the password and try again.";
const UNREADABLE_MESSAGE = "This PDF could not be read. Try another file or take photos instead.";
const MIXED_MESSAGE = "Choose one PDF or up to 10 photos, not both.";

type Described = { name: string; type: string };
export type ChoiceCheck = { ok: true; kind: "photos" | "pdf" } | { ok: false; message: string };

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Whether `incoming` can be added to the files already `chosen`: one PDF, or up to 10 photos. */
export function checkChoice(chosen: Described[], incoming: Described[]): ChoiceCheck {
  const all = [...chosen, ...incoming];
  const pdfs = all.filter((f) => f.type === "application/pdf").length;
  const photos = all.filter((f) => PHOTO_TYPES.includes(f.type)).length;
  if (pdfs + photos < all.length)
    return { ok: false, message: "Use a PDF, or photos (JPEG, PNG or WebP)." };
  if (pdfs > 0 && photos > 0) return { ok: false, message: MIXED_MESSAGE };
  if (pdfs > 1) return { ok: false, message: "Choose one PDF at a time." };
  if (pdfs === 1) return { ok: true, kind: "pdf" };
  if (photos > MAX_IMAGES_PER_SHEET_UPLOAD)
    return { ok: false, message: `Choose at most ${MAX_IMAGES_PER_SHEET_UPLOAD} photos.` };
  return { ok: true, kind: "photos" };
}

/** The render scale that gives the page's long side MAX_LONG_EDGE pixels. */
export function pageScale(widthPt: number, heightPt: number): number {
  if (!(widthPt > 0) || !(heightPt > 0)) throw new Error("Page size must be positive");
  return MAX_LONG_EDGE / Math.max(widthPt, heightPt);
}

/** The message to show for an error thrown while opening or rendering a PDF. */
export function pdfErrorMessage(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "PasswordException" ? PASSWORD_MESSAGE : UNREADABLE_MESSAGE;
}

/** The part of a PDF library this code needs, so tests can pass a fake. */
export type PdfDocumentLike = {
  numPages: number;
  /** 1-based page number to a JPEG no larger than MAX_LONG_EDGE on its long side. */
  renderPage(pageNumber: number): Promise<Blob>;
  destroy(): Promise<void>;
};

export type PdfOpener = (data: Uint8Array) => Promise<PdfDocumentLike>;

/** Browser only: opens a PDF with pdf.js, loaded on demand. */
export const openWithPdfJs: PdfOpener = async (data) => {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data }).promise;
  return {
    numPages: doc.numPages,
    async renderPage(pageNumber) {
      const page = await doc.getPage(pageNumber);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: pageScale(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not prepare the image");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.85),
        );
        // Release the pixels before the next page is rendered.
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error("Could not prepare the image");
        return blob;
      } finally {
        page.cleanup();
      }
    },
    destroy: () => doc.destroy(),
  };
};

/**
 * Renders every page of a PDF to a JPEG file (`<name>-page-1.jpg`, ...). Throws an Error whose
 * message is ready to show: more than 10 pages, password-protected, or unreadable. Nothing
 * is uploaded here.
 */
export async function renderPdfPages(
  file: File,
  open: PdfOpener = openWithPdfJs,
): Promise<File[]> {
  let doc: PdfDocumentLike;
  try {
    doc = await open(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    throw new Error(pdfErrorMessage(error));
  }
  try {
    if (doc.numPages < 1) throw new Error(UNREADABLE_MESSAGE);
    if (doc.numPages > MAX_PDF_PAGES)
      throw new Error(
        `This PDF has ${doc.numPages} pages. Use a PDF of at most ${MAX_PDF_PAGES} pages.`,
      );
    const base = file.name.replace(/\.[^.]+$/, "") || "working";
    const pages: File[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      try {
        const blob = await doc.renderPage(n);
        pages.push(new File([blob], `${base}-page-${n}.jpg`, { type: "image/jpeg" }));
      } catch (error) {
        throw new Error(pdfErrorMessage(error));
      }
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => {});
  }
}
