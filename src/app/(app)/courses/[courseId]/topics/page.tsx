import Link from "next/link";

import { EmptyState, Meter, PageHeader, Panel, SectionTitle } from "@/components/page-parts";
import { buttonVariants } from "@/components/ui/button";
import { TopicPanel } from "@/components/topic-panel";
import { FocusNext } from "@/components/insights/focus-next";
import { getCourseMastery } from "@/db/queries/mastery";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function TopicsPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/topics">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const query = await searchParams;
  const { topics, prereqs } = await getCourseMastery(user.id, courseId);
  const rawTopic = query.topic;
  const selected = topics.find((t) => t.id === (Array.isArray(rawTopic) ? rawTopic[0] : rawTopic));

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={`${course.name}: topics`}
        description={
          topics.length > 0
            ? "Colour shows mastery, size shows attempts, faded means little evidence yet. Select a topic."
            : undefined
        }
      />
      {topics.length === 0 ? (
        <EmptyState>
          No topics yet. They appear once a sheet has been read. Upload your first problem sheet on
          the Sheets tab.
        </EmptyState>
      ) : (
        <Panel className="p-3 sm:p-4">
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
        </Panel>
      )}
      {topics.length > 0 ? <FocusNext courseId={course.id} topics={topics} /> : null}
      {selected ? (
        <Panel id="topic-actions" className="flex scroll-mt-20 flex-col gap-3" aria-live="polite">
          <SectionTitle>{selected.name}</SectionTitle>
          <p className="text-muted-foreground">
            {selected.mastery === null
              ? "No marked attempts yet."
              : `Mastery ${Math.round(selected.mastery * 100)}% from ${selected.attempts} ${selected.attempts === 1 ? "attempt" : "attempts"}.`}
          </p>
          {selected.mastery !== null ? (
            <Meter value={selected.mastery} label={`Mastery of ${selected.name}`} />
          ) : null}
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
            <Link
              href={`/revise?course=${course.id}&topic=${selected.id}&mode=spot_error`}
              className={buttonVariants({ variant: "outline" })}
            >
              Spot the error
            </Link>
          </div>
        </Panel>
      ) : null}
    </section>
  );
}
