import { TabNav } from "@/components/tab-nav";

import { courseTabs } from "./tabs";

export default async function CourseLayout({
  children,
  params,
}: LayoutProps<"/courses/[courseId]">) {
  const { courseId } = await params;

  return (
    <>
      <TabNav label="Course" tabs={courseTabs(`/courses/${courseId}`)} />
      {children}
    </>
  );
}
