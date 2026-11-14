import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listQuestionsWithTopics } from "@/db/queries/sheets";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { isStale } from "@/lib/pipeline/stale";

import { retryHintsAction, retryParseAction } from "./actions";

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
    <section className="flex flex-col gap-4">
      <AutoRefresh active={reading || hintsPending} />
      <div>
        <Link
          href={`/courses/${sheet.courseId}/sheets`}
          className="text-muted-foreground text-sm underline"
        >
          All sheets
        </Link>
        <h1 className="text-xl font-semibold">{sheet.title}</h1>
      </div>

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
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">
            {stuck
              ? "This is taking longer than expected."
              : (sheet.error ?? "We could not read this sheet.")}
          </p>
          <form action={retryParseAction.bind(null, sheet.id)}>
            <Button type="submit">Try again</Button>
          </form>
        </div>
      ) : null}

      {hintsStuck ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">Hints could not be prepared for some questions.</p>
          <form action={retryHintsAction.bind(null, sheet.id)}>
            <Button type="submit">Prepare the hints again</Button>
          </form>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {questions.map((question) => (
            <li key={question.id}>
              <Link
                href={`/questions/${question.id}`}
                className="hover:bg-muted flex flex-col gap-2 rounded-lg border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Question {question.label}</span>
                  <span className="text-muted-foreground text-xs">
                    about {question.expectedMinutes} min · {HINTS_LABEL[question.hintsStatus]}
                  </span>
                </div>
                <div
                  className={
                    question.body.length > 280
                      ? "max-h-32 overflow-hidden text-sm [mask-image:linear-gradient(to_bottom,black_65%,transparent)]"
                      : "text-sm"
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
        </ol>
      ) : null}
    </section>
  );
}
