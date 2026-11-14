import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLatestAttemptFor } from "@/db/queries/attempts";
import { getMarkScreenData } from "@/db/queries/marking";
import { orNotFound } from "@/lib/auth/guards";
import { requireQuestion } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import type { ErrorType, Outcome } from "@/lib/domain";
import { isStale } from "@/lib/pipeline/stale";

import { retryMarkAction } from "./actions";

// The retry button starts the AI marking again, which can run for a minute or two.
export const maxDuration = 300;

const OUTCOME_LABEL: Record<Outcome, string> = {
  full: "Full marks",
  partial: "Partly right",
  stuck: "Stuck",
};
const OUTCOME_VARIANT: Record<Outcome, "default" | "secondary" | "destructive"> = {
  full: "default",
  partial: "secondary",
  stuck: "destructive",
};
const ERROR_LABEL: Record<ErrorType, string> = {
  conceptual: "Concept",
  method: "Method",
  algebra_slip: "Algebra slip",
  misread_question: "Misread the question",
  incomplete: "Incomplete",
};

export default async function MarkPage({
  params,
  searchParams,
}: PageProps<"/questions/[questionId]/mark">) {
  const user = await requireUser();
  const { questionId } = await params;
  const query = await searchParams;
  const sessionId = typeof query.session === "string" && query.session ? query.session : undefined;

  const question = await orNotFound(requireQuestion(user.id, questionId));
  const requested = typeof query.attempt === "string" ? query.attempt : undefined;
  const attemptId = requested ?? (await getLatestAttemptFor(user.id, questionId, sessionId))?.id;
  if (!attemptId) return <NothingToMark questionId={questionId} sessionId={sessionId} />;

  const data = await orNotFound(getMarkScreenData(user.id, attemptId));
  // The attempt in the address must be one of this question's.
  if (data.question.id !== question.id)
    return <NothingToMark questionId={questionId} sessionId={sessionId} />;

  const { submission, current } = data;
  const back = `/questions/${questionId}${sessionId ? `?session=${sessionId}` : ""}`;
  const marking = submission?.submittedAt && !current && submission.markStatus === "pending";
  const stuck = marking && isStale(submission.markStatusUpdatedAt);
  const waiting = marking && !stuck;
  const failed =
    submission?.submittedAt &&
    !current &&
    (submission.markStatus === "failed" || stuck || submission.markStatus === "none");

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={Boolean(waiting)} />
      <div>
        <Link href={back} className="text-muted-foreground text-sm underline">
          Back to question {question.label}
        </Link>
        <h1 className="text-xl font-semibold">Question {question.label}: mark</h1>
      </div>

      {!submission?.submittedAt ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">This attempt has not been submitted yet.</p>
          <Link href={back} className="underline">
            Go back and submit your working
          </Link>
        </div>
      ) : null}

      {waiting ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground text-sm">Marking your working…</p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {failed ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">
            {submission?.markStatus === "none"
              ? "Your working has not been marked yet."
              : stuck
                ? "Marking is taking longer than expected."
                : "We could not mark your working."}
          </p>
          <form action={retryMarkAction.bind(null, questionId, attemptId)}>
            <Button type="submit">Mark my working</Button>
          </form>
        </div>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={OUTCOME_VARIANT[current.outcome]}>
              {OUTCOME_LABEL[current.outcome]}
            </Badge>
            <span className="text-lg font-semibold">{current.score}/100</span>
            {current.errorType ? (
              <Badge variant="outline">{ERROR_LABEL[current.errorType]}</Badge>
            ) : null}
            <span className="text-muted-foreground text-xs">
              {current.basis === "official"
                ? "AI-marked against the official solutions"
                : "AI-marked, provisional"}
            </span>
          </div>

          {current.firstWrongStep ? (
            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                Where it first goes wrong
              </p>
              <MathText className="text-sm">{current.firstWrongStep}</MathText>
            </div>
          ) : null}

          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Feedback</p>
            <MathText className="text-sm">{current.feedback}</MathText>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Overall</p>
            <MathText className="text-sm">{current.overallFeedback}</MathText>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NothingToMark({ questionId, sessionId }: { questionId: string; sessionId?: string }) {
  return (
    <section className="flex flex-col items-start gap-3">
      <p className="text-sm">There is no attempt to mark yet.</p>
      <Link
        href={`/questions/${questionId}${sessionId ? `?session=${sessionId}` : ""}`}
        className="underline"
      >
        Go to the question
      </Link>
    </section>
  );
}
