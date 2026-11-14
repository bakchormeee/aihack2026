"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadDropzone, type UploadedFile } from "@/components/upload-dropzone";

import { createSheetAction } from "./actions";

export function SheetUploadForm({ courseId }: { courseId: string }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(files: UploadedFile[]) {
    setError(null);
    startTransition(async () => {
      const result = await createSheetAction({
        courseId,
        title,
        files: files.map((file) => ({ key: file.key, name: file.name })),
      });
      // On success the action redirects, so a result here is always an error.
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 sm:max-w-xl">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sheet-title">
          Sheet title (optional, taken from the file name if empty)
        </Label>
        <Input
          id="sheet-title"
          value={title}
          maxLength={150}
          placeholder="Problem Sheet 1"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <UploadDropzone
        purpose="sheet"
        parentId={courseId}
        maxFiles={10}
        allowPdf
        disabled={pending}
        label="Upload the blank problem sheet."
        onUploaded={create}
      />
      {pending ? <p className="text-muted-foreground text-sm">Creating the sheet…</p> : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
