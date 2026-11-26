// The evaluation of one submitted attempt, shown on the question page (SPEC-study-views.md,
// mark-in-place). It was the body of the mark screen, `questions/[id]/mark/page.tsx`.

import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { MarkingScheme, MistakeList } from "@/components/mistake-list";
import { MistakeFocusProvider } from "@/components/mistake-focus";
import { Panel, SectionTitle } from "@/components/page-parts";
import { PhotoWithBoxes } from "@/components/photo-with-boxes";
import { PlaySound } from "@/components/play-sound";
import { WorkingWithBoxes } from "@/components/working-with-boxes";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { visibleHintsFor } from "@/db/queries/attempts";
import { getMarkScreenData, getVisibleSolution, hasOfficialSolution } from "@/db/queries/marking";
import { ERROR_LABEL, OUTCOME_LABEL, solutionLabel } from "@/lib/marking/labels";
import { numberMistakes } from "@/lib/marking/numbering";
import { outcomeLabel } from "@/lib/scores/status";
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
  const official = await hasOfficialSolution(userId, questionId);
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

  const mistakes = current?.mistakes ?? [];
  const numbers = numberMistakes(mistakes, {
    text: submission?.text ?? null,
    fileMimes: (submission?.files ?? []).map((file) => file.mime),
  });

  return (
    <MistakeFocusProvider>
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
            {official && current?.basis === "ai"
              ? "Re-marking against the official solution… the AI mark stays until it is ready."
              : "Marking again… the earlier mark stays until the new one is ready."}
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

        {submission?.submittedAt ? (
          <section aria-labelledby="working-heading" className="flex flex-col gap-3">
            <h2 id="working-heading" className="text-lg font-medium">
              Your working (submitted)
            </h2>
            {mistakes.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                Red is a structural mistake, amber a careless slip. The numbers match the notes
                below.
              </p>
            ) : null}
            {submission.text?.trim() ? (
              <div className="bg-muted/40 rounded-md border p-3">
                <WorkingWithBoxes text={submission.text} mistakes={mistakes} numbers={numbers} />
              </div>
            ) : null}
            {submission.files.map((file, index) =>
              file.mime.startsWith("image/") ? (
                <PhotoWithBoxes
                  key={file.id}
                  src={`/api/files/submission/${file.id}`}
                  fileIndex={index}
                  mistakes={mistakes}
                  numbers={numbers}
                />
              ) : (
                <a
                  key={file.id}
                  href={`/api/files/submission/${file.id}`}
                  className="text-sm underline underline-offset-4"
                >
                  Open the PDF
                </a>
              ),
            )}
          </section>
        ) : null}

        {current ? (
          <div className="flex flex-col gap-5">
            <PlaySound
              sound={OUTCOME_SOUND[current.outcome]}
              once={`mark:${attemptId}:${current.score}:${current.outcome}`}
            />
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-heading text-4xl tabular-nums">{current.score} / 5</span>
                <span className="text-lg">· {outcomeLabel(current.outcome, current.score)}</span>
              </p>
              <p className="text-muted-foreground text-xs">
                {[
                  current.errorType ? ERROR_LABEL[current.errorType] : null,
                  hintsText(hintLevel),
                  current.basis === "official"
                    ? "AI-marked against the official solutions"
                    : "AI-marked, provisional",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <MathText>{current.feedback}</MathText>
              {current.overallFeedback && current.overallFeedback !== current.feedback ? (
                <MathText className="text-muted-foreground">{current.overallFeedback}</MathText>
              ) : null}
            </div>

            {mistakes.length > 0 ? (
              <MistakeList mistakes={mistakes} numbers={numbers} />
            ) : current.firstWrongStep ? (
              <p className="text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  Where it first goes wrong:{" "}
                </span>
                <MathText className="inline">{current.firstWrongStep}</MathText>
              </p>
            ) : null}

            <details className="text-sm">
              <summary className="text-muted-foreground cursor-pointer">
                How marks out of 5 work
              </summary>
              <div className="mt-3">
                <MarkingScheme score={current.score} />
              </div>
            </details>

            {solution ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">
                  {solutionLabel(solution.basis)}
                </summary>
                <div className="mt-3">
                  <MathText>{solution.body}</MathText>
                </div>
              </details>
            ) : null}

            {current.outcome !== "full" ? (
              <div className="flex flex-wrap items-center gap-3">
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
                {!solution ? (
                  <span className="text-muted-foreground text-xs">
                    The worked solution unlocks when you get it fully right, or after all three
                    hints.
                  </span>
                ) : null}
              </div>
            ) : null}

            {submission?.markStatus === "done" ? (
              canDispute(disputeCount) ? (
                <details className="text-sm">
                  <summary className="text-muted-foreground cursor-pointer underline-offset-4 hover:underline">
                    Ask for a re-mark ({2 - disputeCount} left)
                  </summary>
                  <div className="mt-3">
                    <DisputeForm
                      questionId={questionId}
                      attemptId={attemptId}
                      remaining={2 - disputeCount}
                    />
                  </div>
                </details>
              ) : (
                <p className="text-muted-foreground text-sm">
                  You have asked for this attempt to be looked at again twice.
                </p>
              )
            ) : null}

            {data.marks.length > 1 ? (
              <section className="flex flex-col gap-3">
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
    </MistakeFocusProvider>
  );
}

/** "no hints", "1 hint", "2 hints": the hints visible to the attempt. */
export function hintsText(level: number): string {
  return level === 0 ? "no hints" : `${level} ${level === 1 ? "hint" : "hints"}`;
}
