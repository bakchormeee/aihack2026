"use client";

// Picker and drag-and-drop upload straight to object storage. Phone photos are
// resized to at most 2000 px before upload. It only uploads; the caller's
// server action must call verifyUploadedObject() on every returned key.
// Frozen after task F5.

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { resizeImageToJpeg } from "@/lib/image-resize";
import { ACCEPTED_MIMES, validateUpload, type UploadCheck } from "@/lib/storage/limits";
import { cn } from "@/lib/utils";

export type UploadedFile = { key: string; mime: string; name: string; size: number };

type Props = {
  purpose: "sheet" | "official_solutions" | "working";
  /** Course id for a sheet, sheet id for official solutions, attempt id for working. */
  parentId: string;
  /** Most files in one go. */
  maxFiles: number;
  /** Allow a single PDF as well as images. A PDF cannot be mixed with images. */
  allowPdf?: boolean;
  onUploaded: (files: UploadedFile[]) => void;
  disabled?: boolean;
  label?: string;
};

type Status = { name: string; state: "waiting" | "uploading" | "done" | "error"; message?: string };

function checkSelection(files: File[], maxFiles: number, allowPdf: boolean): UploadCheck {
  if (files.length === 0) return { ok: false, message: "Choose a file." };
  if (files.length > maxFiles) return { ok: false, message: `Choose at most ${maxFiles} files.` };
  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length > 0 && !allowPdf) return { ok: false, message: "Use images here, not a PDF." };
  if (pdfs.length > 0 && files.length > 1)
    return { ok: false, message: "Use one PDF, or several images, not both." };
  return { ok: true };
}

export function UploadDropzone({
  purpose,
  parentId,
  maxFiles,
  allowPdf = true,
  onUploaded,
  disabled,
  label,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);

  const accept = (
    allowPdf ? ACCEPTED_MIMES : ACCEPTED_MIMES.filter((m) => m !== "application/pdf")
  ).join(",");

  async function uploadOne(original: File): Promise<UploadedFile> {
    const file = original.type === "application/pdf" ? original : await resizeImageToJpeg(original);
    const check = validateUpload({ mime: file.type, size: file.size });
    if (!check.ok) throw new Error(check.message);

    const presign = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, parentId, mime: file.type, size: file.size }),
    });
    const presigned = (await presign.json().catch(() => null)) as {
      key?: string;
      url?: string;
      error?: string;
    } | null;
    if (!presign.ok || !presigned?.key || !presigned.url)
      throw new Error(presigned?.error ?? "Could not start the upload.");

    const put = await fetch(presigned.url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error("The upload failed. Please try again.");
    return { key: presigned.key, mime: file.type, name: original.name, size: file.size };
  }

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    setError(null);
    const selection = checkSelection(files, maxFiles, allowPdf);
    if (!selection.ok) return setError(selection.message);

    setBusy(true);
    setStatuses(files.map((f) => ({ name: f.name, state: "waiting" })));
    const uploaded: UploadedFile[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const update = (status: Status) =>
          setStatuses((all) => all.map((s, i) => (i === index ? status : s)));
        update({ name: file.name, state: "uploading" });
        try {
          uploaded.push(await uploadOne(file));
          update({ name: file.name, state: "done" });
        } catch (e) {
          const message = e instanceof Error ? e.message : "The upload failed.";
          update({ name: file.name, state: "error", message });
          setError(message);
          return; // keep nothing half-finished: the caller gets files only when all succeeded
        }
      }
      onUploaded(uploaded);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && !busy) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center text-sm",
          dragging ? "border-foreground bg-muted" : "border-border",
        )}
      >
        <p className="text-muted-foreground">
          {label ?? "Drag files here, or choose them."} {allowPdf ? "One PDF, or up to " : "Up to "}
          {maxFiles} images (JPEG, PNG, WebP).
        </p>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          className="sr-only"
          id={`upload-${purpose}-${parentId}`}
          disabled={disabled || busy}
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Uploading…" : "Choose files"}
        </Button>
      </div>

      {statuses.length > 0 ? (
        <ul className="text-sm" aria-live="polite">
          {statuses.map((s, i) => (
            <li key={`${s.name}-${i}`} className="flex justify-between gap-2">
              <span className="truncate">{s.name}</span>
              <span className="text-muted-foreground shrink-0">
                {s.state === "done"
                  ? "Uploaded"
                  : s.state === "uploading"
                    ? "Uploading…"
                    : s.state === "error"
                      ? "Failed"
                      : "Waiting"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
