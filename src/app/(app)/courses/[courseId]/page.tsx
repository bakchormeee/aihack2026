import { SheetsView } from "./sheets/sheets-view";

// The upload action starts the background parse, which can run for a few minutes.
export const maxDuration = 300;

/** A course opens on its Sheets tab. */
export default async function CoursePage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const query = await searchParams;
  return <SheetsView courseId={courseId} deleted={Boolean(query.deleted)} />;
}
