"use client";

// Uploading working for several questions at once (SPEC-batch-working.md): choose up
// to 10 photos, let the AI propose which part answers which question, check and
// correct that, then crop in the browser and submit every matched question.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  cancelBatchAction,
  openBatchAttemptsAction,
  proposeBatchAction,
  submitBatchAction,
} from "@/app/(app)/sheets/[sheetId]/batch/actions";
import { MarkWithAiSwitch } from "@/components/mark-with-ai-switch";
import { MathText } from "@/components/math-text";
import { Panel, SectionTitle } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { MAX_BATCH_PHOTOS, readingOrder, validateAssignments, type Box } from "@/lib/batch/regions";
import { mapLimit } from "@/lib/concurrency";
import { cropImage, resizeImageToJpeg } from "@/lib/image-resize";
import { checkChoice, renderPdfPages } from "@/lib/pdf-pages";
import { ACCEPTED_IMAGE_MIMES, validateUpload } from "@/lib/storage/limits";
import { cn } from "@/lib/utils";

import { RegionEditor } from "./region-editor";

type Photo = { key: string; url: string; file: File; width: number; height: number };
type EditRegion = { id: number; photo: number; box: Box; questionId: string | null };
type Question = { id: string; label: string; body: string };
type Editing =
  { mode: "adjust"; regionId: number } | { mode: "draw"; photo: number; questionId: string | null };

const NOT_MATCHED = "";

/** Uploads one file to a URL the server signs. Returns the storage key. */
async function upload(purpose: "batch" | "working", parentId: string, file: File) {
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
  return presigned.key;
}

async function sizeOf(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

const isPdf = (file: File) => file.type === "application/pdf";

/** The part of the photo inside the box, scaled to the width available (at most 12rem high). */
function CropPreview({ photo, box, label }: { photo: Photo; box: Box; label: string }) {
  const ratio = (box.w * photo.width) / (box.h * photo.height);
  return (
    <div
      className="bg-muted relative max-w-full overflow-hidden rounded-md border"
      style={{ aspectRatio: `${ratio}`, width: `min(100%, ${(12 * ratio).toFixed(2)}rem)` }}
    >
      {/* A local photo the student has just chosen (an object URL). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={label}
        draggable={false}
        className="absolute max-w-none"
        style={{
          width: `${100 / box.w}%`,
          left: `${(-box.x / box.w) * 100}%`,
          top: `${(-box.y / box.h) * 100}%`,
        }}
      />
    </div>
  );
}

function QuestionSelect({
  id,
  value,
  questions,
  onChange,
}: {
  id: string;
  value: string | null;
  questions: Question[];
  onChange: (questionId: string | null) => void;
}) {
  return (
    <select
      id={id}
      value={value ?? NOT_MATCHED}
      onChange={(event) => onChange(event.target.value === NOT_MATCHED ? null : event.target.value)}
      className="border-input bg-background h-11 w-full min-w-0 rounded-lg border px-2 text-sm sm:h-9 sm:w-auto"
    >
      {questions.map((q) => (
        <option key={q.id} value={q.id}>
          Question {q.label}
        </option>
      ))}
      <option value={NOT_MATCHED}>Not matched (leave out)</option>
    </select>
  );
}

export function BatchWorking({
  sheetId,
  sheetHref,
  initialMarkWithAi = true,
  officialQuestionIds = [],
}: {
  sheetId: string;
  sheetHref: string;
  /** The sheet's last position of the "Mark with AI now" switch. */
  initialMarkWithAi?: boolean;
  /** Questions of this sheet that already have an official solution. */
  officialQuestionIds?: string[];
}) {
  const router = useRouter();
  const [aiNow, setAiNow] = useState(initialMarkWithAi);
  const [chosen, setChosen] = useState<File[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [skipped, setSkipped] = useState<{ questionId: string; label: string }[]>([]);
  const [regions, setRegions] = useState<EditRegion[]>([]);
  const [stage, setStage] = useState<"pick" | "matching-failed" | "review">("pick");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(1);
  const finished = useRef(false);
  const uploadedKeys = useRef<string[]>([]);
  const urls = useRef<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  // Leaving without confirming is the same as Cancel (best effort; the sheet page
  // also deletes photos left behind).
  useEffect(() => {
    const discard = () => {
      if (finished.current || uploadedKeys.current.length === 0) return;
      finished.current = true;
      void cancelBatchAction({ sheetId }).catch(() => {});
    };
    window.addEventListener("pagehide", discard);
    const objectUrls = urls.current;
    return () => {
      window.removeEventListener("pagehide", discard);
      discard();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [sheetId]);

  function addFiles(list: FileList | File[]) {
    setError(null);
    const files = Array.from(list);
    const check = checkChoice(chosen, files);
    if (!check.ok) return setError(check.message);
    setChosen([...chosen, ...files]);
  }

  async function propose(keys: string[]) {
    setBusy("Matching your working to the questions… This can take a minute.");
    const result = await proposeBatchAction({ sheetId, photoKeys: keys }).catch(
      () =>
        ({ ok: false, error: "Matching failed. Check your connection and try again." }) as const,
    );
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      setStage("matching-failed");
      return;
    }
    const { proposal } = result;
    setQuestions(proposal.questions);
    setSkipped(proposal.skipped);
    setRegions([
      ...proposal.matched.flatMap((m) =>
        m.regions.map((r) => ({ id: nextId.current++, ...r, questionId: m.questionId })),
      ),
      ...proposal.unmatched.map((r) => ({ id: nextId.current++, ...r, questionId: null })),
    ]);
    setStage("review");
  }

  async function uploadAndMatch() {
    setError(null);
    const uploaded: Photo[] = [];
    try {
      // A PDF becomes one JPEG per page here, before anything is uploaded; the pages
      // are then treated exactly like photos.
      let sources = chosen;
      if (chosen.length === 1 && isPdf(chosen[0])) {
        setBusy("Reading the PDF…");
        sources = await renderPdfPages(chosen[0]);
      }
      for (const [index, original] of sources.entries()) {
        setBusy(
          `Uploading ${isPdf(chosen[0]) ? "page" : "photo"} ${index + 1} of ${sources.length}…`,
        );
        const file = await resizeImageToJpeg(original);
        const size = await sizeOf(file);
        const key = await upload("batch", sheetId, file);
        uploadedKeys.current.push(key);
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        uploaded.push({ key, url, file, ...size });
      }
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "The upload failed. Please try again.");
      return;
    }
    setPhotos(uploaded);
    await propose(uploaded.map((p) => p.key));
  }

  async function cancel() {
    finished.current = true;
    setBusy("Cancelling…");
    if (uploadedKeys.current.length > 0) await cancelBatchAction({ sheetId }).catch(() => {});
    router.push(sheetHref);
  }

  const groups = questions
    .map((q) => ({
      question: q,
      regions: readingOrder(regions.filter((r) => r.questionId === q.id)),
    }))
    .filter((g) => g.regions.length > 0);
  const unmatched = readingOrder(regions.filter((r) => r.questionId === null));
  const missing = questions.filter((q) => !groups.some((g) => g.question.id === q.id));

  async function submit() {
    setError(null);
    const problem = validateAssignments(
      groups.map((g) => ({
        questionId: g.question.id,
        regions: g.regions.map((r) => ({ photo: r.photo, box: r.box })),
      })),
      { photoCount: photos.length, eligibleQuestionIds: new Set(questions.map((q) => q.id)) },
    );
    if (problem) return setError(problem);

    setBusy("Preparing the questions…");
    try {
      const opened = await openBatchAttemptsAction({
        sheetId,
        questionIds: groups.map((g) => g.question.id),
      });
      if (!opened.ok) throw new Error(opened.error);

      let done = 0;
      const total = groups.reduce((sum, g) => sum + g.regions.length, 0);
      const confirmed = [];
      for (const g of groups) {
        const attempt = opened.attempts.find((a) => a.questionId === g.question.id)!;
        const cropKeys = await mapLimit(g.regions, 3, async (r, index) => {
          const crop = await cropImage(
            photos[r.photo].file,
            r.box,
            `question-${g.question.label.replace(/[^A-Za-z0-9]+/g, "-")}-${index + 1}.jpg`,
          );
          const key = await upload("working", attempt.attemptId, crop);
          done += 1;
          setBusy(`Saving the crops: ${done} of ${total}…`);
          return key;
        });
        confirmed.push({ questionId: g.question.id, cropKeys });
      }

      setBusy("Submitting…");
      const result = await submitBatchAction({ sheetId, markWithAi: aiNow, questions: confirmed });
      if (!result.ok) throw new Error(result.error);
      finished.current = true;
      router.push(sheetHref);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  const update = (id: number, change: Partial<EditRegion>) =>
    setRegions((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const errorText = error ? (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  ) : null;
  const busyText = busy ? (
    <p className="text-muted-foreground text-sm" aria-live="polite">
      {busy}
    </p>
  ) : null;

  if (stage === "pick" || stage === "matching-failed") {
    const uploaded = photos.length > 0;
    return (
      <div className="flex flex-col gap-4">
        {!uploaded ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (!busy) addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-6 text-center text-sm",
              dragging ? "border-foreground bg-muted" : "border-border",
            )}
          >
            <p className="text-muted-foreground">
              Drag photos here, choose them, or take them with your camera. Up to {MAX_BATCH_PHOTOS}{" "}
              photos (JPEG, PNG, WebP), or one PDF of up to 10 pages.
            </p>
            <input
              ref={picker}
              type="file"
              accept={[...ACCEPTED_IMAGE_MIMES, "application/pdf"].join(",")}
              multiple
              className="sr-only"
              aria-label="Choose photos"
              disabled={!!busy}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Take a photo"
              disabled={!!busy}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!!busy}
                onClick={() => picker.current?.click()}
              >
                Choose photos
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!!busy}
                onClick={() => camera.current?.click()}
              >
                Take a photo
              </Button>
            </div>
          </div>
        ) : null}

        {chosen.length > 0 && !uploaded ? (
          <ul className="flex flex-col gap-1 text-sm">
            {chosen.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {isPdf(file) ? "PDF" : `Photo ${index + 1}`}: {file.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setChosen((all) => all.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {busyText}
        {errorText}

        <div className="flex flex-wrap gap-2">
          {stage === "matching-failed" ? (
            <Button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setError(null);
                void propose(photos.map((p) => p.key));
              }}
            >
              Try again
            </Button>
          ) : (
            <Button
              type="button"
              disabled={chosen.length === 0 || !!busy}
              onClick={() => void uploadAndMatch()}
            >
              Upload and match
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={busy === "Cancelling…"}
            onClick={() => void cancel()}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (editing) {
    const region =
      editing.mode === "adjust" ? regions.find((r) => r.id === editing.regionId) : undefined;
    const photoIndex = editing.mode === "adjust" ? (region?.photo ?? 0) : editing.photo;
    return (
      <Panel className="flex flex-col gap-4">
        <SectionTitle>
          {editing.mode === "adjust" ? "Adjust the box" : "Draw a new box"}
        </SectionTitle>
        {editing.mode === "draw" ? (
          <div className="flex flex-col gap-3">
            {photos.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Photo">
                {photos.map((p, index) => (
                  <Button
                    key={p.key}
                    type="button"
                    size="sm"
                    variant={index === editing.photo ? "default" : "outline"}
                    aria-pressed={index === editing.photo}
                    onClick={() => setEditing({ ...editing, photo: index })}
                  >
                    Photo {index + 1}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor="draw-question" className="text-sm font-medium">
                Give it to
              </label>
              <QuestionSelect
                id="draw-question"
                value={editing.questionId}
                questions={questions}
                onChange={(questionId) => setEditing({ ...editing, questionId })}
              />
            </div>
          </div>
        ) : null}
        <RegionEditor
          key={`${editing.mode}-${photoIndex}-${region?.id ?? "new"}`}
          photoUrl={photos[photoIndex].url}
          photoLabel={`Photo ${photoIndex + 1}`}
          initial={region?.box ?? null}
          doneLabel={editing.mode === "adjust" ? "Done" : "Add this box"}
          onCancel={() => setEditing(null)}
          onDone={(box) => {
            if (editing.mode === "adjust") update(editing.regionId, { box });
            else
              setRegions((all) => [
                ...all,
                { id: nextId.current++, photo: editing.photo, box, questionId: editing.questionId },
              ]);
            setEditing(null);
          }}
        />
      </Panel>
    );
  }

  const regionCard = (r: EditRegion, index: number, title: string) => (
    <li key={r.id} className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <p className="text-muted-foreground text-xs">
        Part {index + 1} · photo {r.photo + 1}
      </p>
      <CropPreview photo={photos[r.photo]} box={r.box} label={`${title}, part ${index + 1}`} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label htmlFor={`region-${r.id}`} className="sr-only">
          Question for this part
        </label>
        <QuestionSelect
          id={`region-${r.id}`}
          value={r.questionId}
          questions={questions}
          onChange={(questionId) => update(r.id, { questionId })}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditing({ mode: "adjust", regionId: r.id })}
          >
            Adjust
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRegions((all) => all.filter((x) => x.id !== r.id))}
          >
            Remove
          </Button>
        </div>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Check each question&apos;s working. Move a part to another question, remove it, adjust its
        box, or draw a box the matching missed. Nothing is submitted until you press Submit and
        mark.
      </p>

      {regions.length === 0 ? (
        <Panel role="status">
          <p>
            Nothing was matched. Draw a box around each question&apos;s working on a photo, or
            cancel.
          </p>
        </Panel>
      ) : null}

      {groups.map((g) => (
        <Panel key={g.question.id} className="flex flex-col gap-3">
          <SectionTitle>Question {g.question.label}</SectionTitle>
          <p className="text-muted-foreground text-xs">
            {officialQuestionIds.includes(g.question.id)
              ? "Marked against the official solution"
              : aiNow
                ? "AI marks now"
                : "Waits for official solution"}
          </p>
          <div className="text-muted-foreground max-h-24 overflow-hidden text-sm [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
            <MathText>{g.question.body}</MathText>
          </div>
          <ul className="flex flex-col gap-3">
            {g.regions.map((r, index) => regionCard(r, index, `Question ${g.question.label}`))}
          </ul>
        </Panel>
      ))}

      {unmatched.length > 0 ? (
        <Panel className="flex flex-col gap-3">
          <SectionTitle>Not matched</SectionTitle>
          <p className="text-muted-foreground text-sm">
            These parts are left out unless you give them to a question.
          </p>
          <ul className="flex flex-col gap-3">
            {unmatched.map((r, index) => regionCard(r, index, "Not matched"))}
          </ul>
        </Panel>
      ) : null}

      {missing.length > 0 || skipped.length > 0 ? (
        <div className="text-muted-foreground flex flex-col gap-1 text-sm">
          {missing.length > 0 ? (
            <p>
              No working found for: {missing.map((q) => `Question ${q.label}`).join(", ")}. They are
              not changed.
            </p>
          ) : null}
          {skipped.length > 0 ? (
            <p>
              Left out because their working is already submitted:{" "}
              {skipped.map((q) => `Question ${q.label}`).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            setEditing({
              mode: "draw",
              photo: 0,
              questionId: missing[0]?.id ?? questions[0]?.id ?? null,
            })
          }
        >
          Draw a new box
        </Button>
      </div>

      {busyText}
      {errorText}

      <MarkWithAiSwitch
        checked={aiNow}
        onCheckedChange={setAiNow}
        total={groups.length}
        official={groups.filter((g) => officialQuestionIds.includes(g.question.id)).length}
        disabled={!!busy}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={groups.length === 0 || !!busy}
          onClick={() => void submit()}
        >
          Submit and mark
        </Button>
        <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void cancel()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
