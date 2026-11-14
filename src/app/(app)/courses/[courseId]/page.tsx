import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { TopicPanel } from "@/components/topic-panel";
import { getCourseMastery } from "@/db/queries/mastery";
import { listSheets } from "@/db/queries/sheets";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function CoursePage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const sheets = await listSheets(user.id, courseId);

  if (sheets.length === 0) {
    return (
      <section className="flex flex-col items-start gap-3">
        <h1 className="text-xl font-semibold">{course.name}</h1>
        <p className="text-muted-foreground text-sm">
          Upload your first problem sheet to build the skill map for this course.
        </p>
        <Link href={`/courses/${course.id}/sheets`} className={buttonVariants()}>
          Upload a sheet
        </Link>
      </section>
    );
  }

  const { topics, prereqs } = await getCourseMastery(user.id, courseId);
  const rawTopic = (await searchParams).topic;
  const selected = topics.find((t) => t.id === (Array.isArray(rawTopic) ? rawTopic[0] : rawTopic));

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{course.name}</h1>
      {topics.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No topics yet. They appear once a sheet has been read.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Colour shows mastery, size shows attempts, faded means little evidence yet. Select a
            topic.
          </p>
          <TopicPanel
            courseId={course.id}
            nodes={topics.map((t) => ({
              id: t.id,
              name: t.name,
              mastery: t.mastery,
              confidence: t.confidence,
              attempts: t.attempts,
            }))}
            links={prereqs.map((p) => ({ source: p.prereqId, target: p.topicId }))}
          />
        </>
      )}
      {selected ? (
        <div className="flex flex-col gap-2 rounded-lg border p-4" aria-live="polite">
          <h2 className="font-medium">{selected.name}</h2>
          <p className="text-muted-foreground text-sm">
            {selected.mastery === null
              ? "No marked attempts yet."
              : `Mastery ${Math.round(selected.mastery * 100)}% from ${selected.attempts} ${selected.attempts === 1 ? "attempt" : "attempts"}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/courses/${course.id}/mistakes?topic=${selected.id}`}
              className={buttonVariants({ variant: "outline" })}
            >
              See mistakes
            </Link>
            <Link
              href={`/revise?course=${course.id}&topic=${selected.id}`}
              className={buttonVariants()}
            >
              Revise this topic
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
