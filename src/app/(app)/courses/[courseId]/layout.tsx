import { TabNav } from "@/components/tab-nav";

export default async function CourseLayout({
  children,
  params,
}: LayoutProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const base = `/courses/${courseId}`;

  return (
    <>
      <TabNav
        label="Course"
        tabs={[
          { href: base, label: "Skill map", exact: true },
          { href: `${base}/sheets`, label: "Sheets" },
          { href: `${base}/mistakes`, label: "Mistakes" },
          { href: `${base}/progress`, label: "Progress" },
        ]}
      />
      {children}
    </>
  );
}
