import { EmptyState, PageHeader } from "@/components/page-parts";
import { TopicList } from "@/components/topic-list";
import { getCourseMastery } from "@/db/queries/mastery";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function TopicsPage({ params }: PageProps<"/courses/[courseId]/topics">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const { topics, prereqs } = await getCourseMastery(user.id, courseId);
  const nameOf = new Map(topics.map((t) => [t.id, t.name]));

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={`${course.name}: topics`}
        description={
          topics.length > 0
            ? "Weakest first. Hover a label, or open a topic, to see its mastery."
            : undefined
        }
      />
      {topics.length === 0 ? (
        <EmptyState>
          No topics yet. They appear once a sheet has been read: upload one on the Sheets tab.
        </EmptyState>
      ) : (
        <TopicList
          courseId={course.id}
          topics={topics.map((t) => ({
            id: t.id,
            name: t.name,
            mastery: t.mastery,
            attempts: t.attempts,
            longFormAttempts: t.longFormAttempts,
            prereqs: prereqs
              .filter((p) => p.topicId === t.id)
              .map((p) => nameOf.get(p.prereqId))
              .filter((name): name is string => name !== undefined),
          }))}
        />
      )}
    </section>
  );
}
