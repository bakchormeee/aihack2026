import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { MarkingScheme, MistakeList } from "@/components/mistake-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SolutionPanel } from "@/components/solution-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { getLatestAttemptFor, visibleHintsFor } from "@/db/queries/attempts";
import { getMarkScreenData, getVisibleSolution } from "@/db/queries/marking";
import { orNotFound } from "@/lib/auth/guards";
import { requireQuestion } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { getNextHref } from "@/lib/navigation";
import type { Outcome } from "@/lib/domain";
import { ERROR_LABEL, OUTCOME_LABEL } from "@/lib/marking/labels";
import { isStale } from "@/lib/pipeline/stale";

import { canDispute } from "@/lib/marking/rules";

import { DisputeForm } from "./dispute-form";
import { retryMarkAction, retryNowAction, retryWithNextHintAction } from "./actions";

// The retry button starts the AI marking again, which can run for a minute or two.
export const maxDuration = 300;

const OUTCOME_VARIANT: Record<Outcome, "default" | "secondary" | "destructive"> = {
  full: "default",
  partial: "secondary",
  stuck: "destructive",
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
  const disputeCount = data.marks.filter((mark) => mark.isDispute).length;
  // Null while the solution is locked: nothing of it is sent to the browser.
  const solution = await getVisibleSolution(user.id, questionId);
  const hintLevel = (await visibleHintsFor(user.id, attemptId)).level;
  const nextHref = await getNextHref({ userId: user.id, questionId, sessionId });
  const back = `/questions/${questionId}${sessionId ? `?session=${sessionId}` : ""}`;
  const marking = submission?.submittedAt && !current && submission.markStatus === "pending";
  const stuck = marking && isStale(submission.markStatusUpdatedAt);
  const waiting = marking && !stuck;
  // A dispute or the official re-mark is running while an earlier mark is shown.
  const remarking =
    submission?.submittedAt &&
    current &&
    submission.markStatus === "pending" &&
    !isStale(submission.markStatusUpdatedAt);
  const failed =
    submission?.submittedAt &&
    !current &&
    (submission.markStatus === "failed" || stuck || submission.markStatus === "none");

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={Boolean(waiting || remarking)} />
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

      {remarking ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Marking again… the earlier mark stays below until the new one is ready.
        </p>
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
            <span className="text-lg font-semibold">{current.score}/5</span>
            {current.errorType ? (
              <Badge variant="outline">{ERROR_LABEL[current.errorType]}</Badge>
            ) : null}
            <span className="text-muted-foreground text-xs">
              {current.basis === "official"
                ? "AI-marked against the official solutions"
                : "AI-marked, provisional"}
            </span>
          </div>

          {current.mistakes && current.mistakes.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-base font-semibold">What to check</h2>
              <MistakeList mistakes={current.mistakes} />
            </div>
          ) : current.firstWrongStep ? (
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

          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              How marks out of 5 work
            </summary>
            <div className="mt-3">
              <MarkingScheme score={current.score} />
            </div>
          </details>

          {current.outcome !== "full" ? (
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <p className="text-sm">
                {solution
                  ? "You can try again, with the worked solution below to help."
                  : "Not there yet. Try again, or take a hint first. The worked solution unlocks when you get it fully right, or after all three hints."}
              </p>
              <div className="flex flex-wrap gap-3">
                <form action={retryNowAction.bind(null, questionId, sessionId)}>
                  <Button type="submit">Retry now</Button>
                </form>
                {hintLevel < 3 && question.hintsStatus === "ready" ? (
                  <form action={retryWithNextHintAction.bind(null, questionId, sessionId)}>
                    <Button type="submit" variant="outline">
                      Retry with hint {hintLevel + 1}
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>
          ) : null}

          {submission?.markStatus === "done" && current.outcome !== "full" ? (
            canDispute(disputeCount) ? (
              <DisputeForm
                questionId={questionId}
                attemptId={attemptId}
                remaining={2 - disputeCount}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                You have asked for this attempt to be looked at again twice.
              </p>
            )
          ) : null}

          {solution ? <SolutionPanel solution={solution} /> : null}

          {data.marks.length > 1 ? (
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-base font-semibold">All marks for this attempt</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {data.marks.map((mark) => (
                  <li key={mark.id} className="flex flex-col gap-0.5">
                    <span>
                      {mark.score}/5 · {OUTCOME_LABEL[mark.outcome]} ·{" "}
                      {mark.basis === "official" ? "official solutions" : "AI, provisional"}
                      {mark.isDispute ? " · you disputed this" : ""}
                      {mark.id === current.id ? " (current)" : ""}
                    </span>
                    {mark.disputeReason ? (
                      <span className="text-muted-foreground text-xs">
                        Your reason: {mark.disputeReason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex justify-end text-sm">
            <Link href={nextHref} className="underline">
              Next →
            </Link>
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
