import { describe, expect, it } from "vitest";

import {
  MAX_PDF_PAGES,
  checkChoice,
  pageScale,
  pdfErrorMessage,
  renderPdfPages,
  type PdfDocumentLike,
} from "./pdf-pages";

const photo = (name = "a.jpg") => ({ name, type: "image/jpeg" });
const pdf = (name = "w.pdf") => ({ name, type: "application/pdf" });

describe("checkChoice", () => {
  it("accepts up to 10 photos", () => {
    expect(
      checkChoice(
        [photo()],
        Array.from({ length: 9 }, () => photo()),
      ),
    ).toEqual({ ok: true, kind: "photos" });
  });

  it("refuses an 11th photo", () => {
    const result = checkChoice(
      Array.from({ length: 10 }, () => photo()),
      [photo()],
    );
    expect(result).toEqual({ ok: false, message: "Choose at most 10 photos." });
  });

  it("accepts one PDF", () => {
    expect(checkChoice([], [pdf()])).toEqual({ ok: true, kind: "pdf" });
  });

  it("refuses two PDFs, at once or one after the other", () => {
    expect(checkChoice([], [pdf(), pdf()]).ok).toBe(false);
    expect(checkChoice([pdf()], [pdf()]).ok).toBe(false);
  });

  it("refuses a PDF with a photo, in either order and either call", () => {
    const message = "Choose one PDF or up to 10 photos, not both.";
    expect(checkChoice([], [pdf(), photo()])).toEqual({ ok: false, message });
    expect(checkChoice([photo()], [pdf()])).toEqual({ ok: false, message });
    expect(checkChoice([pdf()], [photo()])).toEqual({ ok: false, message });
  });

  it("refuses other file types", () => {
    expect(checkChoice([], [{ name: "n.txt", type: "text/plain" }]).ok).toBe(false);
  });

  it("accepts nothing as nothing", () => {
    expect(checkChoice([], [])).toEqual({ ok: true, kind: "photos" });
  });
});

describe("pageScale", () => {
  it("scales a page so its long side is 2000 pixels", () => {
    expect(792 * pageScale(612, 792)).toBeCloseTo(2000, 5);
  });

  it("rejects an empty page size", () => {
    expect(() => pageScale(0, 100)).toThrow();
  });
});

describe("pdfErrorMessage", () => {
  it("names a password-protected PDF", () => {
    expect(pdfErrorMessage({ name: "PasswordException" })).toBe(
      "This PDF is password-protected. Remove the password and try again.",
    );
  });

  it("treats anything else as unreadable", () => {
    const unreadable = "This PDF could not be read. Try another file or take photos instead.";
    expect(pdfErrorMessage({ name: "InvalidPDFException" })).toBe(unreadable);
    expect(pdfErrorMessage(new Error("boom"))).toBe(unreadable);
    expect(pdfErrorMessage(null)).toBe(unreadable);
  });
});

function fakeDoc(pages: number, log: string[] = []): PdfDocumentLike {
  return {
    numPages: pages,
    async renderPage(n) {
      log.push(`render ${n}`);
      return new Blob([`page ${n}`], { type: "image/jpeg" });
    },
    async destroy() {
      log.push("destroy");
    },
  };
}

const file = new File(["%PDF"], "My Working.pdf", { type: "application/pdf" });

describe("renderPdfPages", () => {
  it("returns one JPEG per page, in order, rendered one at a time", async () => {
    const log: string[] = [];
    const result = await renderPdfPages(file, async () => fakeDoc(3, log));
    expect(result.map((f) => f.name)).toEqual([
      "My Working-page-1.jpg",
      "My Working-page-2.jpg",
      "My Working-page-3.jpg",
    ]);
    expect(result.every((f) => f.type === "image/jpeg")).toBe(true);
    expect(log).toEqual(["render 1", "render 2", "render 3", "destroy"]);
  });

  it("accepts exactly 10 pages", async () => {
    const result = await renderPdfPages(file, async () => fakeDoc(MAX_PDF_PAGES));
    expect(result).toHaveLength(10);
  });

  it("refuses 11 pages before rendering any", async () => {
    const log: string[] = [];
    await expect(renderPdfPages(file, async () => fakeDoc(11, log))).rejects.toThrow(
      "This PDF has 11 pages. Use a PDF of at most 10 pages.",
    );
    expect(log).toEqual(["destroy"]);
  });

  it("refuses a PDF with no pages", async () => {
    await expect(renderPdfPages(file, async () => fakeDoc(0))).rejects.toThrow(/could not be read/);
  });

  it("maps a password error from opening", async () => {
    await expect(
      renderPdfPages(file, async () => {
        throw { name: "PasswordException" };
      }),
    ).rejects.toThrow(/password-protected/);
  });

  it("maps an error while rendering and still releases the document", async () => {
    const log: string[] = [];
    const doc = fakeDoc(2, log);
    doc.renderPage = async () => {
      throw new Error("bad page");
    };
    await expect(renderPdfPages(file, async () => doc)).rejects.toThrow(/could not be read/);
    expect(log).toEqual(["destroy"]);
  });
});
