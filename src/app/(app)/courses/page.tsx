import Link from "next/link";

import { EmptyState, PageHeader, Panel } from "@/components/page-parts";
import { listCourses } from "@/db/queries/courses";
import { requireUser } from "@/lib/auth/session";

import { CreateCourseForm } from "./create-course-form";

export default async function CoursesPage() {
  const user = await requireUser();
  const courses = await listCourses(user.id);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader title="Your courses" />
      {courses.length === 0 ? (
        <EmptyState>
          No courses yet. Create one for each university module, then upload its problem sheets.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${course.id}`}
                className="bg-card hover:border-foreground/40 group flex h-full min-h-28 flex-col justify-between gap-4 rounded-lg border p-5 transition-[border-color,transform] duration-150 hover:-translate-y-px"
              >
                <span className="font-heading text-xl leading-snug font-medium">{course.name}</span>
                <span className="text-muted-foreground group-hover:text-foreground text-sm transition-colors">
                  Open course <span aria-hidden="true">→</span>
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
