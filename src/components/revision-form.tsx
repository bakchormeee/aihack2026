"use client";

import { Check, RotateCcw, Search } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/page-parts";
import { cn } from "@/lib/utils";
import { CommonErrors, type CommonError } from "@/components/common-errors";
import { rankMisconceptions } from "@/lib/spot/rules";
import { SPOT_QUESTION_COUNTS, type SessionMode } from "@/lib/domain";
import {
  hideMisconceptionAction,
  startRevisionAction,
  startSpotSessionAction,
} from "@/app/(app)/revise/actions";

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
      const result =
        mode === "spot_error"
          ? await startSpotSessionAction({ courseId, questionCount: count, topicIds })
          : await startRevisionAction({ courseId, targetMinutes: minutes, topicIds });
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
      <legend className="mb-2 text-sm font-medium">Kind of revision</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            [
              "long_form",
              "Long-form questions",
              "Retry what went wrong, plus fresh variants.",
              RotateCcw,
            ],
            [
              "spot_error",
              "Spot the error",
              "Find the slips planted from your common errors.",
              Search,
            ],
          ] as const
        ).map(([value, label, blurb, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "lift bg-card flex items-start gap-3 rounded-lg border p-3 text-left",
              "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
              mode === value && "border-pen ring-pen/20 ring-2 hover:border-pen",
            )}
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                mode === value ? "bg-pen border-pen text-white" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-heading text-base font-medium">{label}</span>
              <span className="text-muted-foreground text-xs leading-snug">{blurb}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );

  const ready = mode === "spot_error" ? plantable > 0 : available > 0;
  const status =
    mode === "spot_error" ? (
      plantable === 0 ? (
        <p
          role="status"
          className="text-muted-foreground bg-muted/40 rounded-md border p-3 text-sm"
        >
          Spot the error needs your common errors, which are built from the mistakes in your marked
          answers{topicIds.length ? ", and none were seen in these topics" : ""}. Get some work
          marked first.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          Questions are built from {plantable} of your common {plantable === 1 ? "error" : "errors"}
          . You find the wrong lines in a worked solution and explain them.
        </p>
      )
    ) : available === 0 ? (
      <p role="status" className="text-muted-foreground bg-muted/40 rounded-md border p-3 text-sm">
        Nothing to revise yet{topicIds.length ? " for these topics" : " in this course"}. Revision
        picks questions you got wrong, got only partly right, or solved with hint 2 or 3. Submit and
        get some work marked first.
      </p>
    ) : (
      <p className="text-muted-foreground text-sm">
        {available} {available === 1 ? "question" : "questions"} to retry, plus fresh variants.
      </p>
    );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel className="flex flex-col gap-6">
        <form
          id="revise-form"
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {modeButtons}

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="revise-course">Course</Label>
              <select
                id="revise-course"
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setTopicIds([]);
                }}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">
                {mode === "spot_error" ? "Number of questions" : "Length"}
              </legend>
              <div className="bg-muted/60 grid grid-cols-3 gap-1 rounded-md border p-1">
                {(mode === "spot_error" ? SPOT_QUESTION_COUNTS : LENGTHS).map((n) => {
                  const on = mode === "spot_error" ? count === n : minutes === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        mode === "spot_error"
                          ? setCount(n as (typeof SPOT_QUESTION_COUNTS)[number])
                          : setMinutes(n as (typeof LENGTHS)[number])
                      }
                      className={cn(
                        "focus-visible:ring-ring/50 h-8 rounded px-2 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3",
                        on
                          ? "bg-card text-foreground font-medium shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {mode === "spot_error" ? `${n} questions` : `${n} minutes`}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {course.topics.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <legend className="text-sm font-medium">
                  Topics{" "}
                  <span className="text-muted-foreground font-normal">
                    {topicIds.length === 0
                      ? "(none selected means all)"
                      : `(${topicIds.length} selected)`}
                  </span>
                </legend>
                {topicIds.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTopicIds([])}
                    className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {course.topics.map((t) => {
                  const on = topicIds.includes(t.id);
                  return (
                    <label key={t.id} className="cursor-pointer">
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={on}
                        onChange={() => toggle(t.id)}
                      />
                      <span
                        className={cn(
                          "peer-focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors peer-focus-visible:ring-3",
                          on
                            ? "border-pen bg-pen text-white"
                            : "bg-background hover:border-foreground/40 text-foreground",
                        )}
                      >
                        {on ? <Check aria-hidden="true" className="size-3.5" /> : null}
                        {t.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
        </form>
      </Panel>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-20">
        <Panel className="border-foreground/80 flex flex-col gap-4 border-t-2">
          <h2 className="text-lg font-medium">Your session</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Kind</dt>
            <dd>{mode === "spot_error" ? "Spot the error" : "Long-form questions"}</dd>
            <dt className="text-muted-foreground">Course</dt>
            <dd className="truncate">{course.name}</dd>
            <dt className="text-muted-foreground">
              {mode === "spot_error" ? "Questions" : "Length"}
            </dt>
            <dd>{mode === "spot_error" ? count : `${minutes} minutes`}</dd>
            <dt className="text-muted-foreground">Topics</dt>
            <dd>
              {topicIds.length === 0
                ? "All"
                : course.topics
                    .filter((t) => topicIds.includes(t.id))
                    .map((t) => t.name)
                    .join(", ")}
            </dd>
          </dl>
          {status}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            form="revise-form"
            size="lg"
            disabled={pending || !ready}
            className="w-full"
          >
            {pending
              ? "Starting…"
              : mode === "spot_error"
                ? "Start spot the error"
                : "Start revision"}
          </Button>
        </Panel>
        {mode === "spot_error" ? (
          <CommonErrors
            errors={course.errors}
            updating={course.updating}
            hideAction={hideMisconceptionAction}
          />
        ) : (
          <div className="text-muted-foreground flex flex-col gap-2 text-sm">
            <p className="text-foreground font-medium">How it works</p>
            <p>
              A session mixes retries of questions you got wrong or needed hints for with fresh
              variants, weakest topics first.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
