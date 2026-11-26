// The evaluation of one submitted attempt, shown on the question page (SPEC-study-views.md,
// mark-in-place). It was the body of the mark screen, `questions/[id]/mark/page.tsx`.

import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { MarkingScheme, MistakeList } from "@/components/mistake-list";
import { Panel, SectionTitle } from "@/components/page-parts";
import { PhotoWithBoxes } from "@/components/photo-with-boxes";
import { PlaySound } from "@/components/play-sound";
import { WorkingWithBoxes } from "@/components/working-with-boxes";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { SolutionPanel } from "@/components/solution-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { visibleHintsFor } from "@/db/queries/attempts";
import { getMarkScreenData, getVisibleSolution } from "@/db/queries/marking";
import type { Outcome } from "@/lib/domain";
import { ERROR_LABEL, OUTCOME_LABEL } from "@/lib/marking/labels";
import { canDispute } from "@/lib/marking/rules";
import { getNextHref } from "@/lib/navigation";
import { isStale } from "@/lib/pipeline/stale";
import { DisputeForm } from "@/app/(app)/questions/[questionId]/mark/dispute-form";
import {
  retryMarkAction,
  retryNowAction,
  retryWithNextHintAction,
} from "@/app/(app)/questions/[questionId]/mark/actions";

const OUTCOME_SOUND = { full: "success", partial: "partial", stuck: "stuck" } as const;

const OUTCOME_VARIANT: Record<Outcome, "default" | "secondary" | "destructive"> = {
  full: "default",
  partial: "secondary",
  stuck: "destructive",
};

type Props = {
  userId: string;
  question: { id: string; hintsStatus: string };
  attemptId: string;
  sessionId?: string;
};

/** Marking state, score, working, feedback and actions of one attempt. Renders nothing for a foreign attempt. */
export async function AttemptEvaluation({ userId, question, attemptId, sessionId }: Props) {
  const questionId = question.id;
  const data = await getMarkScreenData(userId, attemptId);
  if (data.question.id !== questionId) return null;

  const { submission, current } = data;
  const disputeCount = data.marks.filter((mark) => mark.isDispute).length;
  // Null while the solution is locked: nothing of it is sent to the browser.
  const solution = await getVisibleSolution(userId, questionId);
  const hintLevel = (await visibleHintsFor(userId, attemptId)).level;
  const nextHref = await getNextHref({ userId, questionId, sessionId });
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
    <div className="flex flex-col gap-6">
      <AutoRefresh active={Boolean(waiting || remarking)} />
      {waiting ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground">Marking your working…</p>
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
        <Panel role="alert" className="flex flex-col items-start gap-3">
          <p>
            {submission?.markStatus === "none"
              ? "Your working has not been marked yet."
              : stuck
                ? "Marking is taking longer than expected."
                : "We could not mark your working."}
          </p>
          <form action={retryMarkAction.bind(null, questionId, attemptId)}>
            <Button type="submit">Mark my working</Button>
          </form>
        </Panel>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-5">
          <Panel className="border-foreground/80 relative flex flex-wrap items-center gap-x-6 gap-y-4 overflow-hidden border-t-2">
            <PlaySound
              sound={OUTCOME_SOUND[current.outcome]}
              once={`mark:${attemptId}:${current.score}:${current.outcome}`}
            />
            <span className="font-heading text-pen stamp rounded-full border-[3px] border-current px-4 py-3 text-5xl leading-none italic tabular-nums">
              {current.score}/5
            </span>
            <div className="flex flex-col gap-2">
              <ScorePips score={current.score} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={OUTCOME_VARIANT[current.outcome]}>
                  {OUTCOME_LABEL[current.outcome]}
                </Badge>
                {current.errorType ? (
                  <Badge variant="outline">{ERROR_LABEL[current.errorType]}</Badge>
                ) : null}
              </div>
              <span className="text-muted-foreground text-xs">
                {current.basis === "official"
                  ? "AI-marked against the official solutions"
                  : "AI-marked, provisional"}
              </span>
            </div>
            {current.outcome === "full" ? (
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="text-pen ml-auto size-16 shrink-0 max-sm:hidden"
              >
                <path
                  d="M4 13.5 9.2 19 20 5"
                  pathLength={100}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pen-draw [--delay:650ms]"
                />
              </svg>
            ) : null}
          </Panel>

          {current.mistakes && current.mistakes.length > 0 && submission?.text?.trim() ? (
            <Panel className="flex flex-col gap-3">
              <SectionTitle>Your working</SectionTitle>
              <p className="text-muted-foreground text-xs">
                Red is a structural mistake, amber a careless slip. The numbers match the list
                below.
              </p>
              <WorkingWithBoxes text={submission.text} mistakes={current.mistakes} />
            </Panel>
          ) : null}

          {current.mistakes &&
          current.mistakes.length > 0 &&
          submission?.files.some((file) => file.mime.startsWith("image/")) ? (
            <Panel className="flex flex-col gap-3">
              <SectionTitle>Your photos</SectionTitle>
              {submission.files.map((file, index) =>
                file.mime.startsWith("image/") ? (
                  <PhotoWithBoxes
                    key={file.id}
                    src={`/api/files/submission/${file.id}`}
                    fileIndex={index}
                    mistakes={current.mistakes ?? []}
                  />
                ) : null,
              )}
            </Panel>
          ) : null}

          {current.mistakes && current.mistakes.length > 0 ? (
            <div className="flex flex-col gap-3">
              <SectionTitle>What to check</SectionTitle>
              <MistakeList mistakes={current.mistakes} />
            </div>
          ) : current.firstWrongStep ? (
            <Panel>
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Where it first goes wrong
              </p>
              <MathText>{current.firstWrongStep}</MathText>
            </Panel>
          ) : null}

          <Panel className="divide-y p-0">
            <div className="px-5 py-4">
              <p className="text-muted-foreground mb-1 text-xs font-medium">Feedback</p>
              <MathText>{current.feedback}</MathText>
            </div>
            <div className="px-5 py-4">
              <p className="text-muted-foreground mb-1 text-xs font-medium">Overall</p>
              <MathText>{current.overallFeedback}</MathText>
            </div>
          </Panel>

          <details className="bg-card rounded-lg border px-5 py-4">
            <summary className="cursor-pointer text-sm font-medium">
              How marks out of 5 work
            </summary>
            <div className="mt-3">
              <MarkingScheme score={current.score} />
            </div>
          </details>

          {current.outcome !== "full" ? (
            <Panel className="flex flex-col gap-4">
              <p>
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
            </Panel>
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
            <section className="bg-card flex flex-col gap-3 rounded-lg border p-5">
              <SectionTitle>All marks for this attempt</SectionTitle>
              <ul className="flex flex-col divide-y text-sm">
                {data.marks.map((mark) => (
                  <li key={mark.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
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

          <div className="flex justify-end border-t pt-4">
            <Link href={nextHref} className={buttonVariants({ variant: "outline" })}>
              Next →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Five marks in a row, the earned ones in red pen. */
function ScorePips({ score }: { score: number }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`pip-in h-2 w-7 rounded-full ${n <= score ? "bg-pen" : "bg-muted"}`}
          style={{ animationDelay: `${400 + n * 80}ms` }}
        />
      ))}
    </div>
  );
}
