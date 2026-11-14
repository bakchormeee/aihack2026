"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { startRevisionAction } from "@/app/(app)/revise/actions";

type CourseOption = {
  id: string;
  name: string;
  topics: { id: string; name: string }[];
  candidateTopics: string[][];
};

const LENGTHS = [20, 45, 90] as const;

export function RevisionForm({
  courses,
  initialCourseId,
  initialTopicId,
}: {
  courses: CourseOption[];
  initialCourseId: string;
  initialTopicId: string | null;
}) {
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

  return (
    <form
      className="flex flex-col gap-5 sm:max-w-lg"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
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

      {available === 0 ? (
        <p role="status" className="text-muted-foreground rounded-lg border p-3 text-sm">
          Nothing to revise yet{topicIds.length ? " for these topics" : " in this course"}. Revision
          picks questions you got wrong, got only partly right, or solved with hint 2 or 3. Submit
          and get some work marked first.
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
      <Button type="submit" disabled={pending || available === 0} className="self-start">
        {pending ? "Starting…" : "Start revision"}
      </Button>
    </form>
  );
}
