"use client";

import { useRef, useState, useTransition } from "react";

import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteQuestionAction,
  mergeQuestionsAction,
  saveBodyAction,
  saveDetailsAction,
  splitQuestionAction,
  type EditResult,
} from "@/app/(app)/sheets/[sheetId]/edit/actions";

const MAX_TOPICS = 3;

type Props = {
  question: {
    id: string;
    label: string;
    body: string;
    hintsStatus: "pending" | "ready" | "failed";
    topics: string[];
  };
  courseTopics: string[];
  attempted: boolean;
  nextQuestionId: string | null;
  nextAttempted: boolean;
};

export function QuestionEditor({
  question,
  courseTopics,
  attempted,
  nextQuestionId,
  nextAttempted,
}: Props) {
  const [label, setLabel] = useState(question.label);
  const [selected, setSelected] = useState(question.topics);
  const [newTopic, setNewTopic] = useState("");
  const [body, setBody] = useState(question.body);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const has = (name: string) => selected.some((s) => s.toLowerCase() === name.toLowerCase());
  const options = [
    ...courseTopics,
    ...selected.filter((s) => !courseTopics.some((c) => c.toLowerCase() === s.toLowerCase())),
  ];
  const canEditBody = !attempted;
  const canMerge = canEditBody && nextQuestionId !== null && !nextAttempted;

  function run(work: () => Promise<EditResult>, done: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      setMessage(result.ok ? { text: done, error: false } : { text: result.error, error: true });
    });
  }

  function toggle(name: string) {
    setSelected((current) =>
      has(name)
        ? current.filter((s) => s.toLowerCase() !== name.toLowerCase())
        : [...current, name],
    );
  }

  function addNewTopic() {
    const name = newTopic.trim();
    if (!name) return;
    if (!has(name)) {
      const existing = courseTopics.find((c) => c.toLowerCase() === name.toLowerCase());
      setSelected((current) => [...current, existing ?? name]);
    }
    setNewTopic("");
  }

  const topicsValid = selected.length >= 1 && selected.length <= MAX_TOPICS;
  const detailsChanged =
    label.trim() !== question.label ||
    selected.length !== question.topics.length ||
    selected.some((s) => !question.topics.includes(s));

  return (
    <div className="bg-card flex flex-col gap-3 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Question {question.label}</span>
        <span className="text-muted-foreground text-xs">
          {attempted ? "Attempted · text locked" : null}
          {attempted ? " · " : null}
          {question.hintsStatus === "pending"
            ? "Hints being prepared…"
            : question.hintsStatus === "failed"
              ? "Hints failed"
              : "Hints ready"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`label-${question.id}`}>
          Label
        </label>
        <Input
          id={`label-${question.id}`}
          value={label}
          maxLength={40}
          onChange={(event) => setLabel(event.target.value)}
          className="max-w-40"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">
          Topics <span className="text-muted-foreground font-normal">(1 to {MAX_TOPICS})</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {options.map((name) => {
            const on = has(name);
            const full = !on && selected.length >= MAX_TOPICS;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                disabled={full}
                onClick={() => toggle(name)}
                className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-3 disabled:opacity-40"
              >
                <Badge variant={on ? "default" : "outline"} className="h-7 px-3 text-sm">
                  {name}
                </Badge>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Input
            aria-label="New topic name"
            placeholder="New topic"
            value={newTopic}
            maxLength={80}
            onChange={(event) => setNewTopic(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addNewTopic();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={addNewTopic}
            disabled={!newTopic.trim() || selected.length >= MAX_TOPICS}
          >
            Add
          </Button>
        </div>
      </fieldset>

      <div>
        <Button
          type="button"
          disabled={pending || !topicsValid || !label.trim() || !detailsChanged}
          onClick={() =>
            run(
              () => saveDetailsAction({ questionId: question.id, label, topicNames: selected }),
              "Label and topics saved.",
            )
          }
        >
          Save label and topics
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`body-${question.id}`}>
          Question text
        </label>
        <Textarea
          id={`body-${question.id}`}
          ref={bodyRef}
          value={body}
          disabled={!canEditBody}
          onChange={(event) => setBody(event.target.value)}
          className="min-h-28 font-mono text-sm"
        />
        {canEditBody ? (
          <>
            <p className="text-muted-foreground text-xs">
              Click in the text where a new question should start, then press &ldquo;Split
              here&rdquo;.
            </p>
            <details className="text-sm">
              <summary className="text-muted-foreground cursor-pointer">Preview</summary>
              <div className="pt-2">
                <MathText>{body}</MathText>
              </div>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending || !body.trim() || body.trim() === question.body}
                onClick={() =>
                  run(
                    () => saveBodyAction({ questionId: question.id, body }),
                    "Text saved. The hints are being written again.",
                  )
                }
              >
                Save text
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || body !== question.body}
                title={body !== question.body ? "Save the text first" : undefined}
                onClick={() => {
                  const index = bodyRef.current?.selectionStart ?? 0;
                  run(
                    () => splitQuestionAction({ questionId: question.id, index }),
                    "Question split in two.",
                  );
                }}
              >
                Split here
              </Button>
              {canMerge ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        mergeQuestionsAction({ firstId: question.id, secondId: nextQuestionId! }),
                      "Merged with the next question.",
                    )
                  }
                >
                  Merge with next
                </Button>
              ) : null}
              {confirmDelete ? (
                <>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={pending}
                    onClick={() =>
                      run(() => deleteQuestionAction({ questionId: question.id }), "Deleted.")
                    }
                  >
                    Delete for good
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={message?.error ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
      >
        {pending ? "Saving…" : (message?.text ?? "")}
      </p>
    </div>
  );
}
