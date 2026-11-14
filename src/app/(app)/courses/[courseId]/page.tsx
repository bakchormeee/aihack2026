// Placeholder from F3, replaced by task V4 (skill map). M1 only shows the course name.
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{course.name}</h1>
      <p className="text-muted-foreground text-sm">The skill map appears here (task V4).</p>
    </section>
  );
}
