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
import { DeleteDialog } from "@/components/delete-dialog";
import { DeletedNotice } from "@/components/deleted-notice";
import { countWhatGoes } from "@/db/queries/bin";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { deleteSentence } from "@/lib/bin/rules";
import { formatScore } from "@/lib/scores/score";

import { deleteCourseAction } from "../delete-actions";
import { SheetUploadForm } from "./sheet-upload-form";

const STATUS_LABEL = { parsing: "Reading the sheet…", ready: "Ready", failed: "Failed" } as const;

/**
 * The course's Sheets tab: upload form, sheet list, empty state and Delete course. It is the page
 * at `/courses/<id>` and, as the old address, at `/courses/<id>/sheets`.
 */
export async function SheetsView({
  courseId,
  deleted,
}: {
  courseId: string;
  /** Show the "Moved to Recently deleted." notice (`?deleted=1`). */
  deleted: boolean;
}) {
  const user = await requireUser();
  const course = await orNotFound(requireCourse(user.id, courseId));
  const overview = await getCourseSheetOverview(user.id, courseId);

  return (
    <section className="flex flex-col gap-8">
      {deleted ? <DeletedNotice /> : null}
      <PageHeader
        title={course.name}
        actions={
          <DeleteDialog
            label="Delete course"
            sentence={deleteSentence({
              kind: "course",
              name: course.name,
              ...(await countWhatGoes(user.id, { courseId })),
            })}
            action={deleteCourseAction.bind(null, course.id)}
          />
        }
      />
      <Panel>
        <SheetUploadForm courseId={course.id} />
      </Panel>
      {overview.length === 0 ? (
        <EmptyState>
          Upload your first problem sheet above to build the topic list for this course.
        </EmptyState>
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
                      <Stat
                        label="Attempted"
                        value={`${stats.score.attempted} / ${stats.score.total}`}
                      />
                      <Stat label="Score" value={formatScore(stats.score)} />
                      <Stat label="Hints used" value={String(stats.hintsRevealed)} />
                      <Stat label="Time" value={formatDuration(stats.secondsSpent)} />
                      <Stat
                        label="Marks"
                        value={
                          stats.score.percent === null
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
