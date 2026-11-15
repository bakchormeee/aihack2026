import Link from "next/link";
import { after } from "next/server";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { PageHeader, Panel, RULED_ROW_LINK, RuledList } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listQuestionsWithTopics } from "@/db/queries/sheets";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { isStale } from "@/lib/pipeline/stale";
import { deleteBatchPhotos } from "@/lib/storage/batch-photos";

import { retryHintsAction, retryParseAction, setTimerAction, submitAllAction } from "./actions";

// The retry button starts the background parse again, which can run for a few minutes.
export const maxDuration = 300;

const HINTS_LABEL = {
  pending: "Hints being prepared…",
  ready: "Hints ready",
  failed: "Hints failed",
} as const;

export default async function SheetPage({ params }: PageProps<"/sheets/[sheetId]">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const sheet = await orNotFound(requireSheet(user.id, sheetId));
  // Photos of a batch upload that was left without confirming (SPEC-batch-working.md).
  after(() =>
    deleteBatchPhotos(user.id, sheet.id).catch((error) =>
      console.error(`deleting leftover batch photos of sheet ${sheet.id} failed`, error),
    ),
  );
  const questions = sheet.status === "ready" ? await listQuestionsWithTopics(user.id, sheetId) : [];

  const stuck = sheet.status === "parsing" && isStale(sheet.statusUpdatedAt);
  const reading = sheet.status === "parsing" && !stuck;
  const hintsPending = questions.some((question) => question.hintsStatus === "pending");
  const hintsStuck = questions.some(
    (question) =>
      question.hintsStatus === "failed" ||
      (question.hintsStatus === "pending" && isStale(question.hintsStatusUpdatedAt)),
  );

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={reading || hintsPending} />
      <PageHeader
        back={{ href: `/courses/${sheet.courseId}/sheets`, label: "All sheets" }}
        title={sheet.title}
        actions={
          <form
            action={setTimerAction.bind(null, sheet.id, !sheet.timerEnabled)}
            className="flex items-center gap-2"
          >
            <span className="text-muted-foreground text-sm">
              Timer is {sheet.timerEnabled ? "on" : "off"}
            </span>
            <Button type="submit" variant="outline" size="sm">
              Turn {sheet.timerEnabled ? "off" : "on"}
            </Button>
          </form>
        }
      />

      {reading ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground text-sm">
            Reading the sheet and splitting it into questions…
          </p>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}

      {sheet.status === "failed" || stuck ? (
        <Panel role="alert" className="flex flex-col items-start gap-3">
          <p>
            {stuck
              ? "This is taking longer than expected."
              : (sheet.error ?? "We could not read this sheet.")}
          </p>
          <form action={retryParseAction.bind(null, sheet.id)}>
            <Button type="submit">Try again</Button>
          </form>
        </Panel>
      ) : null}

      {hintsStuck ? (
        <Panel role="alert" className="flex flex-col items-start gap-3">
          <p>Hints could not be prepared for some questions.</p>
          <form action={retryHintsAction.bind(null, sheet.id)}>
            <Button type="submit">Prepare the hints again</Button>
          </form>
        </Panel>
      ) : null}

      {questions.length > 0 ? (
        <form
          action={submitAllAction.bind(null, sheet.id)}
          className="flex flex-wrap items-center gap-3"
        >
          <Button type="submit" variant="outline">
            Submit all drafts
          </Button>
          <span className="text-muted-foreground text-sm">
            Submits the working you have written or attached on any question but not yet submitted.
          </span>
        </form>
      ) : null}

      {questions.length > 0 ? (
        <RuledList>
          {questions.map((question) => (
            <li key={question.id}>
              <Link href={`/questions/${question.id}`} className={`${RULED_ROW_LINK} gap-3 py-5`}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-heading text-lg font-medium">
                    Question {question.label}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    about {question.expectedMinutes} min · {HINTS_LABEL[question.hintsStatus]}
                  </span>
                </div>
                <div
                  className={
                    question.body.length > 280
                      ? "max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
                      : undefined
                  }
                >
                  <MathText>{question.body}</MathText>
                </div>
                <div className="flex flex-wrap gap-1">
                  {question.topics.map((topic) => (
                    <Badge key={topic.id} variant="secondary">
                      {topic.name}
                    </Badge>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </RuledList>
      ) : null}
    </section>
  );
}
