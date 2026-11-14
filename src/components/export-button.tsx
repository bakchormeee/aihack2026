"use client";

import { toPng } from "html-to-image";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import { buildHandInPdf, type ResolvedPage } from "@/lib/export/build-pdf";
import { planHandIn, type HandInQuestion } from "@/lib/export/hand-in";

const TEXT_WIDTH = 700; // CSS pixels of the typed-working image
const PAGE_RATIO = 770 / 523; // height / width of the printable box on an A4 page

async function fetchBytes(fileId: string): Promise<Uint8Array> {
  const response = await fetch(`/api/files/submission/${fileId}`);
  if (!response.ok) throw new Error(`Could not download a working file (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read an image"));
    image.src = url;
  });
}

async function canvasBytes(canvas: HTMLCanvasElement, type: string): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("Could not prepare an image");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Photos other than JPEG and PNG (for example WebP) are redrawn as JPEG. */
async function photoBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: "image/jpeg" | "image/png" }> {
  if (mime === "image/jpeg" || mime === "image/png") return { bytes, mime };
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, bitmap.width, bitmap.height);
  context.drawImage(bitmap, 0, 0);
  return { bytes: await canvasBytes(canvas, "image/jpeg"), mime: "image/jpeg" };
}

/** Draws typed working (Markdown and maths) as PNG images, one per page-height slice. */
async function renderText(text: string): Promise<Uint8Array[]> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${TEXT_WIDTH}px;padding:16px;background:#fff;color:#000;font-size:15px;line-height:1.5`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<MathText>{text}</MathText>));
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const url = await toPng(host, { pixelRatio: 2, backgroundColor: "#fff" });
    const image = await loadImage(url);
    const sliceHeight = Math.floor(image.width * PAGE_RATIO);
    const slices: Uint8Array[] = [];
    for (let top = 0; top < image.height; top += sliceHeight) {
      const height = Math.min(sliceHeight, image.height - top);
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, height);
      context.drawImage(image, 0, top, image.width, height, 0, 0, image.width, height);
      slices.push(await canvasBytes(canvas, "image/png"));
    }
    return slices;
  } finally {
    root.unmount();
    host.remove();
  }
}

async function buildPdf(questions: HandInQuestion[]): Promise<Uint8Array> {
  const resolved: ResolvedPage[] = [];
  for (const page of planHandIn(questions)) {
    if (page.kind === "notAttempted") {
      resolved.push(page);
    } else if (page.kind === "text") {
      const slices = await renderText(page.text);
      slices.forEach((bytes, index) =>
        resolved.push({
          kind: "image",
          label: page.label,
          continued: page.continued || index > 0,
          bytes,
          mime: "image/png",
        }),
      );
    } else if (page.kind === "image") {
      const photo = await photoBytes(await fetchBytes(page.fileId), page.mime);
      resolved.push({ kind: "image", label: page.label, continued: page.continued, ...photo });
    } else {
      resolved.push({
        kind: "pdf",
        label: page.label,
        continued: page.continued,
        bytes: await fetchBytes(page.fileId),
      });
    }
  }
  return buildHandInPdf(resolved);
}

/** Builds one PDF of the student's working for the whole sheet, in the browser. */
export function ExportButton({ title, questions }: { title: string; questions: HandInQuestion[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const bytes = await buildPdf(questions);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^\w.-]+/g, "-")}-hand-in.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the PDF.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy}>
        {busy ? "Building PDF…" : "Export hand-in PDF"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
