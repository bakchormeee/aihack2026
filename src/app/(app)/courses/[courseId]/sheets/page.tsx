import Link from "next/link";

import { formatDuration } from "@/components/attempt-card";
import { HeatStrip } from "@/components/charts/heat-strip";
import {
  EmptyState,
  PageHeader,
  Panel,
  RULED_ROW_LINK,
  RuledList,
  SectionTitle,
} from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { getCourseSheetOverview } from "@/db/queries/history";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

import { SheetUploadForm } from "./sheet-upload-form";

// The upload action starts the background parse, which can run for a few minutes.
export const maxDuration = 300;

const STATUS_LABEL = { parsing: "Reading the sheet…", ready: "Ready", failed: "Failed" } as const;

export default async function SheetsPage({ params }: PageProps<"/courses/[courseId]/sheets">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const overview = await getCourseSheetOverview(user.id, courseId);

  return (
    <section className="flex flex-col gap-8">
      <PageHeader title={`${course.name}: sheets`} />
      <Panel>
        <SheetUploadForm courseId={course.id} />
      </Panel>
      {overview.length === 0 ? (
        <EmptyState>No sheets yet. Upload the first one above.</EmptyState>
      ) : (
        <>
          <Panel className="flex flex-col gap-3">
            <SectionTitle>Results by question</SectionTitle>
            <HeatStrip
              rows={overview
                .filter(({ sheet }) => sheet.status === "ready")
                .map(({ heat }) => heat)}
            />
          </Panel>
          <RuledList>
            {overview.map(({ sheet, stats }) => (
              <li key={sheet.id}>
                <Link href={`/sheets/${sheet.id}`} className={`${RULED_ROW_LINK} gap-3`}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-heading text-lg font-medium">{sheet.title}</span>
                    <Badge variant={sheet.status === "failed" ? "destructive" : "secondary"}>
                      {STATUS_LABEL[sheet.status]}
                    </Badge>
                  </span>
                  {sheet.status === "ready" ? (
                    <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
                      <Stat label="Submitted" value={`${stats.submitted} / ${stats.total}`} />
                      <Stat
                        label="Average score"
                        value={stats.averageScore === null ? "–" : `${stats.averageScore}/5`}
                      />
                      <Stat label="Hints used" value={String(stats.hintsRevealed)} />
                      <Stat label="Time" value={formatDuration(stats.secondsSpent)} />
                      <Stat
                        label="Marks"
                        value={
                          stats.averageScore === null
                            ? "–"
                            : stats.confirmed
                              ? "Confirmed"
                              : "Provisional"
                        }
                      />
                    </dl>
                  ) : null}
                </Link>
              </li>
            ))}
          </RuledList>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs">{label}</dt>
      <dd className="text-foreground font-medium tabular-nums">{value}</dd>
    </div>
  );
}
