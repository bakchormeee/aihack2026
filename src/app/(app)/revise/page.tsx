import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { topics } from "@/db/schema";
import { listCourses } from "@/db/queries/courses";
import { listRetryCandidates } from "@/db/queries/revision";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { RevisionForm } from "@/components/revision-form";

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
    courses.map(async (course) => ({
      id: course.id,
      name: course.name,
      topics: await db
        .select({ id: topics.id, name: topics.name })
        .from(topics)
        .where(eq(topics.courseId, course.id))
        .orderBy(topics.name),
      // The topics of each question to retry, so the form can count what a topic choice leaves.
      candidateTopics: (await listRetryCandidates(user.id, course.id)).map((c) => c.topicIds),
    })),
  );

  const wantedCourse = one(query.course);
  const initialCourseId = options.find((o) => o.id === wantedCourse)?.id ?? options[0]?.id ?? null;
  const wantedTopic = one(query.topic);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Revision</h1>
      {options.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Create a course and mark some work first.{" "}
          <Link href="/courses" className={buttonVariants({ variant: "link" })}>
            Go to courses
          </Link>
        </p>
      ) : (
        <RevisionForm
          courses={options}
          initialCourseId={initialCourseId!}
          initialTopicId={wantedTopic ?? null}
        />
      )}
    </section>
  );
}
