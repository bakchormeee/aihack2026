import { SheetsView } from "./sheets-view";

// The upload action starts the background parse, which can run for a few minutes.
export const maxDuration = 300;

/** The old address of the Sheets tab, kept working: it shows what `/courses/<id>` shows. */
export default async function SheetsPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/sheets">) {
  const { courseId } = await params;
  const query = await searchParams;
  return <SheetsView courseId={courseId} deleted={Boolean(query.deleted)} />;
}
