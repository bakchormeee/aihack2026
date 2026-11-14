"use client";

import { useState, useTransition } from "react";

import { UploadDropzone, type UploadedFile } from "@/components/upload-dropzone";

import { uploadSolutionsAction } from "./actions";

export function SolutionsUploadForm({ sheetId, label }: { sheetId: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(files: UploadedFile[]) {
    setError(null);
    startTransition(async () => {
      const result = await uploadSolutionsAction({
        sheetId,
        files: files.map((file) => ({ key: file.key })),
      });
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:max-w-xl">
      <UploadDropzone
        purpose="official_solutions"
        parentId={sheetId}
        maxFiles={10}
        allowPdf
        disabled={pending}
        label={label}
        onUploaded={save}
      />
      {pending ? <p className="text-muted-foreground text-sm">Saving…</p> : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
