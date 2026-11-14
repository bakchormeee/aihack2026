"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CommonErrors, type CommonError } from "@/components/common-errors";
import { rankMisconceptions } from "@/lib/spot/rules";
import { SPOT_QUESTION_COUNTS, type SessionMode } from "@/lib/domain";
import { hideMisconceptionAction, startRevisionAction } from "@/app/(app)/revise/actions";

type CourseOption = {
  id: string;
  name: string;
  topics: { id: string; name: string }[];
  candidateTopics: string[][];
  /** The course's visible common errors, with the topics they were seen in. */
  errors: (CommonError & { topicIds: string[] })[];
  /** The list of common errors is being brought up to date. */
  updating: boolean;
};

const LENGTHS = [20, 45, 90] as const;

export function RevisionForm({
  courses,
  initialCourseId,
  initialTopicId,
  initialMode = "long_form",
}: {
  courses: CourseOption[];
  initialCourseId: string;
  initialTopicId: string | null;
  initialMode?: SessionMode;
}) {
  const [mode, setMode] = useState<SessionMode>(initialMode);
  const [count, setCount] = useState<(typeof SPOT_QUESTION_COUNTS)[number]>(10);
  const [courseId, setCourseId] = useState(initialCourseId);
  const [minutes, setMinutes] = useState<(typeof LENGTHS)[number]>(45);
  const course = courses.find((c) => c.id === courseId)!;
  const [topicIds, setTopicIds] = useState<string[]>(
    initialTopicId && course.topics.some((t) => t.id === initialTopicId) ? [initialTopicId] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const available =
    topicIds.length === 0
      ? course.candidateTopics.length
      : course.candidateTopics.filter((ids) => ids.some((id) => topicIds.includes(id))).length;

  function toggle(id: string) {
    setTopicIds((current) =>
      current.includes(id) ? current.filter((t) => t !== id) : [...current, id],
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await startRevisionAction({ courseId, targetMinutes: minutes, topicIds });
      if (result?.error) setError(result.error);
    });
  }

  // How many of the student's common errors a spot-the-error session could use.
  const plantable = rankMisconceptions(
    course.errors.map((e) => ({
      id: e.id,
      timesSeen: e.timesSeen,
      lastSeen: new Date(e.lastSeen ?? 0),
      topicIds: e.topicIds,
      hidden: false,
    })),
    topicIds,
  ).length;

  const modeButtons = (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Kind of revision</legend>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["long_form", "Long-form questions"],
            ["spot_error", "Spot the error"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? "default" : "outline"}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="flex flex-col gap-8 sm:max-w-lg">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {modeButtons}

        <div className="flex flex-col gap-2">
          <Label htmlFor="revise-course">Course</Label>
          <select
            id="revise-course"
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setTopicIds([]);
            }}
            className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {mode === "spot_error" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Number of questions</legend>
            <div className="flex gap-2">
              {SPOT_QUESTION_COUNTS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={count === n ? "default" : "outline"}
                  aria-pressed={count === n}
                  onClick={() => setCount(n)}
                >
                  {n} questions
                </Button>
              ))}
            </div>
          </fieldset>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Length</legend>
            <div className="flex gap-2">
              {LENGTHS.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={minutes === m ? "default" : "outline"}
                  aria-pressed={minutes === m}
                  onClick={() => setMinutes(m)}
                >
                  {m} minutes
                </Button>
              ))}
            </div>
          </fieldset>
        )}

        {course.topics.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Topics (none selected means all)</legend>
            <div className="flex flex-col gap-1">
              {course.topics.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={topicIds.includes(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {mode === "spot_error" ? (
          <>
            {plantable === 0 ? (
              <p role="status" className="text-muted-foreground rounded-lg border p-3 text-sm">
                Spot the error needs your common errors, which are built from the mistakes in your
                marked answers{topicIds.length ? ", and none were seen in these topics" : ""}. Get
                some work marked first.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Questions are built from {plantable} of your common{" "}
                {plantable === 1 ? "error" : "errors"}. You find the wrong lines in a worked
                solution and explain them.
              </p>
            )}
          </>
        ) : available === 0 ? (
          <p role="status" className="text-muted-foreground rounded-lg border p-3 text-sm">
            Nothing to revise yet{topicIds.length ? " for these topics" : " in this course"}.
            Revision picks questions you got wrong, got only partly right, or solved with hint 2 or
            3. Submit and get some work marked first.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {available} {available === 1 ? "question" : "questions"} to retry, plus fresh variants.
          </p>
        )}

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        {mode === "long_form" ? (
          <Button type="submit" disabled={pending || available === 0} className="self-start">
            {pending ? "Starting…" : "Start revision"}
          </Button>
        ) : null}
      </form>
      {mode === "spot_error" ? (
        <CommonErrors
          errors={course.errors}
          updating={course.updating}
          hideAction={hideMisconceptionAction}
        />
      ) : null}
    </div>
  );
}
