import Link from "next/link";
import { after } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { topics } from "@/db/schema";
import { listCourses } from "@/db/queries/courses";
import { getCourseMisconceptionState } from "@/db/queries/misconceptions";
import { listRetryCandidates } from "@/db/queries/revision";
import { AutoRefresh } from "@/components/auto-refresh";
import { EmptyState, PageHeader } from "@/components/page-parts";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { RevisionForm } from "@/components/revision-form";
import { refreshMisconceptions } from "@/lib/pipeline/misconceptions";
import { SESSION_MODES } from "@/lib/domain";

// The start action builds the session after the response, which can run for a few minutes.
export const maxDuration = 300;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RevisionPage({ searchParams }: PageProps<"/revise">) {
  const user = await requireUser();
  const query = await searchParams;
  const courses = await listCourses(user.id);

  const options = await Promise.all(
    courses.map(async (course) => {
      const state = await getCourseMisconceptionState(user.id, course.id);
      // Marks the grouping job has not read yet are read after this response is sent.
      if (state.shouldStart) after(() => refreshMisconceptions(user.id, course.id));
      return {
        id: course.id,
        name: course.name,
        topics: await db
          .select({ id: topics.id, name: topics.name })
          .from(topics)
          .where(eq(topics.courseId, course.id))
          .orderBy(topics.name),
        // The topics of each question to retry, so the form can count what a topic choice leaves.
        candidateTopics: (await listRetryCandidates(user.id, course.id)).map((c) => c.topicIds),
        errors: state.visible.map((m) => ({
          id: m.id,
          description: m.description,
          timesSeen: m.timesSeen,
          lastSeen: m.lastSeen?.toISOString() ?? null,
          example: m.example,
          topicIds: m.topicIds,
        })),
        updating: state.updating,
      };
    }),
  );

  const wantedCourse = one(query.course);
  const initialCourseId = options.find((o) => o.id === wantedCourse)?.id ?? options[0]?.id ?? null;
  const wantedTopic = one(query.topic);
  const wantedMode = one(query.mode);
  const initialMode = SESSION_MODES.find((m) => m === wantedMode) ?? "long_form";

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={options.some((o) => o.updating)} />
      <PageHeader
        title="Revision"
        description="Retry what went wrong, try fresh variants, or spot the error in a worked solution."
      />
      {options.length === 0 ? (
        <EmptyState
          action={
            <Link href="/courses" className={buttonVariants({ variant: "outline" })}>
              Go to courses
            </Link>
          }
        >
          Create a course and mark some work first.
        </EmptyState>
      ) : (
        <RevisionForm
          courses={options}
          initialCourseId={initialCourseId!}
          initialTopicId={wantedTopic ?? null}
          initialMode={initialMode}
        />
      )}
    </section>
  );
}
