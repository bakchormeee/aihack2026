"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import {
  addWorkingFilesAction,
  removeWorkingFileAction,
  saveDraftTextAction,
  submitWorkingAction,
  type WorkingFile,
} from "@/app/(app)/questions/[questionId]/submit-actions";
import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UploadDropzone, type UploadedFile } from "@/components/upload-dropzone";

type Props = {
  /** Null until the browser has opened the attempt. */
  attemptId: string | null;
  initialText: string;
  initialFiles: WorkingFile[];
  submitted: boolean;
  /** Called after a successful submit, so the page can show the mark. */
  onSubmitted: () => void;
  /** Runs just before the working is submitted (for example, to save the timer). */
  beforeSubmit?: () => Promise<void>;
};

const SAVE_DELAY_MS = 800;

function FileList({ files, onRemove }: { files: WorkingFile[]; onRemove?: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {files.map((file, index) => (
        <li key={file.id} className="flex items-center justify-between gap-2">
          <a
            href={`/api/files/submission/${file.id}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {file.mime === "application/pdf" ? "PDF" : `Photo ${index + 1}`}
          </a>
          {onRemove ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(file.id)}>
              Remove
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Typed working with a live preview, photos or a PDF, saved as a draft, then submitted once. */
export function WorkingInput({
  attemptId,
  initialText,
  initialFiles,
  submitted,
  onSubmitted,
  beforeSubmit,
}: Props) {
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState(initialFiles);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [pending, startTransition] = useTransition();
  const lastSaved = useRef(initialText);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function saveNow(value: string): Promise<boolean> {
    if (!attemptId || value === lastSaved.current) return true;
    setSaved("saving");
    const result = await saveDraftTextAction({ attemptId, text: value }).catch(
      () => ({ ok: false, error: "Your work could not be saved. Check your connection." }) as const,
    );
    if (!result.ok) {
      setError(result.error);
      setSaved("idle");
      return false;
    }
    lastSaved.current = value;
    setSaved("saved");
    return true;
  }

  useEffect(() => {
    if (submitted || !attemptId) return;
    timer.current = setTimeout(() => void saveNow(text), SAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // saveNow only reads attemptId and refs; re-running on `text` is what debounces it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, attemptId, submitted]);

  function addFiles(uploaded: UploadedFile[]) {
    if (!attemptId) return;
    setError(null);
    startTransition(async () => {
      const result = await addWorkingFilesAction({
        attemptId,
        keys: uploaded.map((file) => file.key),
      });
      if (result.ok) setFiles(result.files);
      else setError(result.error);
    });
  }

  function remove(fileId: string) {
    if (!attemptId) return;
    setError(null);
    startTransition(async () => {
      const result = await removeWorkingFileAction({ attemptId, fileId });
      if (result.ok) setFiles(result.files);
      else setError(result.error);
    });
  }

  function submit() {
    if (!attemptId) return;
    setError(null);
    startTransition(async () => {
      if (!(await saveNow(text))) return;
      await beforeSubmit?.();
      const result = await submitWorkingAction({ attemptId });
      if (result.ok) onSubmitted();
      else setError(result.error);
    });
  }

  if (submitted) {
    return (
      <section
        aria-labelledby="working-heading"
        className="bg-card flex flex-col gap-3 rounded-lg border p-5"
      >
        <h2 id="working-heading" className="text-lg font-medium">
          Your working (submitted)
        </h2>
        {text.trim() ? (
          <div className="bg-muted/40 rounded-md border p-3">
            <MathText>{text}</MathText>
          </div>
        ) : null}
        <FileList files={files} />
      </section>
    );
  }

  const hasWorking = text.trim().length > 0 || files.length > 0;

  return (
    <section
      aria-labelledby="working-heading"
      className="bg-card flex flex-col gap-4 rounded-lg border p-5"
    >
      <h2 id="working-heading" className="text-lg font-medium">
        Your working
      </h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor="working-text">
          Type it (maths in $…$ or $$…$$), or attach photos or a PDF below
        </Label>
        <Textarea
          id="working-text"
          value={text}
          rows={6}
          maxLength={20000}
          disabled={!attemptId}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => void saveNow(text)}
          placeholder={"Let $\\varepsilon = 1$. Then …"}
        />
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {saved === "saving"
            ? "Saving…"
            : saved === "saved"
              ? "Draft saved"
              : "Drafts save automatically"}
        </p>
        {text.trim() ? (
          <div className="bg-muted/40 rounded-md border p-3">
            <p className="text-muted-foreground mb-1 text-xs font-medium">Preview</p>
            <MathText>{text}</MathText>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {attemptId ? (
          <UploadDropzone
            purpose="working"
            parentId={attemptId}
            maxFiles={10}
            allowPdf
            disabled={pending}
            label="Attach photos of your working, or a PDF."
            onUploaded={addFiles}
          />
        ) : null}
        <FileList files={files} onRemove={remove} />
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button type="button" onClick={submit} disabled={!attemptId || !hasWorking || pending}>
          {pending ? "Working…" : "Submit working"}
        </Button>
        <p className="text-muted-foreground text-xs">
          You cannot change working after you submit it.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
