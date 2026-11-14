import { ProgressChart } from "@/components/progress-chart";
import { getCourseEvents, getCourseMastery } from "@/db/queries/mastery";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function ProgressPage({ params }: PageProps<"/courses/[courseId]/progress">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const [{ topics }, events] = await Promise.all([
    getCourseMastery(user.id, courseId),
    getCourseEvents(user.id, courseId),
  ]);

  const withData = topics.filter((t) => t.series.length > 0);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{course.name}: progress</h1>
      {withData.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing to show yet. Mastery over time appears once some of your work has been marked.
        </p>
      ) : (
        <ProgressChart
          topics={withData.map((t) => ({
            id: t.id,
            name: t.name,
            series: t.series.map((p) => ({ at: p.at.toISOString(), mastery: p.mastery })),
          }))}
          events={events.map((e) => ({ at: e.at.toISOString(), kind: e.kind, label: e.label }))}
        />
      )}
    </section>
  );
}
