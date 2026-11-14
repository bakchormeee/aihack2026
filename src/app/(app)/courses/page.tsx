import Link from "next/link";

import { listCourses } from "@/db/queries/courses";
import { requireUser } from "@/lib/auth/session";

import { CreateCourseForm } from "./create-course-form";

export default async function CoursesPage() {
  const user = await requireUser();
  const courses = await listCourses(user.id);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Your courses</h1>
      <CreateCourseForm />
      {courses.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No courses yet. Create one for each university module, then upload its problem sheets.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${course.id}`}
                className="hover:border-foreground/25 hover:bg-muted/40 block rounded-lg border p-4 font-medium transition-colors"
              >
                {course.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
