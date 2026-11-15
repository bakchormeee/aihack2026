import Link from "next/link";
import { after } from "next/server";

import { DeletedNotice } from "@/components/deleted-notice";
import { EmptyState, PageHeader, Panel } from "@/components/page-parts";
import { listBin } from "@/db/queries/bin";
import { eraseDueBinItems, logEraseFailure } from "@/db/queries/bin-erase";
import { listCourses } from "@/db/queries/courses";
import { requireUser } from "@/lib/auth/session";

import { CreateCourseForm } from "./create-course-form";

export default async function CoursesPage({ searchParams }: PageProps<"/courses">) {
  const user = await requireUser();
  const courses = await listCourses(user.id);
  const bin = await listBin(user.id);
  const binHasItems = bin.courses.length + bin.sheets.length > 0;
  // Items 30 days in the bin are erased after this response is sent.
  if (binHasItems) after(() => eraseDueBinItems(user.id).catch(logEraseFailure));

  return (
    <section className="flex flex-col gap-8">
      {(await searchParams).deleted ? <DeletedNotice /> : null}
      <PageHeader
        title="Your courses"
        actions={
          binHasItems ? (
            <Link
              href="/courses/deleted"
              className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
            >
              Recently deleted
            </Link>
          ) : null
        }
      />
      {courses.length === 0 ? (
        <EmptyState>
          No courses yet. Create one for each university module, then upload its problem sheets.
        </EmptyState>
      ) : (
        <ul className="rise-children grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${course.id}`}
                className="bg-card lift group relative flex h-full min-h-28 flex-col justify-between gap-4 overflow-hidden rounded-lg border p-5 before:bg-pen before:absolute before:inset-y-0 before:left-0 before:w-1 before:origin-top before:scale-y-0 before:transition-transform before:duration-300 hover:before:scale-y-100"
              >
                <span className="font-heading text-xl leading-snug font-medium">{course.name}</span>
                <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
                  Open course{" "}
                  <span
                    aria-hidden="true"
                    className="inline-block transition-transform group-hover:translate-x-1"
                  >
                    →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Panel>
        <CreateCourseForm />
      </Panel>
    </section>
  );
}
