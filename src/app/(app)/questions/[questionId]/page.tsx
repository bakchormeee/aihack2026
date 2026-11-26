import { eq } from "drizzle-orm";

import { AttemptEvaluation } from "@/components/attempt-evaluation";
import { AttemptTimeline } from "@/components/attempt-timeline";
import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { PageHeader, Panel } from "@/components/page-parts";
import { QuestionView } from "@/components/question-view";
import { getLatestAttemptFor, getSheetNeighbours, visibleHintsFor } from "@/db/queries/attempts";
import { getQuestionTimeline } from "@/db/queries/history";
import { getVisibleSolution } from "@/db/queries/marking";
import { officialQuestionIds } from "@/db/queries/mark-switch";
import { getWorkingFor } from "@/db/queries/working";
import { SolutionPanel } from "@/components/solution-panel";
import { db } from "@/db";
import { sheets } from "@/db/schema";
import { notFound } from "next/navigation";

import { orNotFound } from "@/lib/auth/guards";
import { requireAttempt, requireQuestion } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { timelineDots } from "@/lib/scores/timeline";

// Submitting starts the AI marking in the background, which can run for a minute or two.
export const maxDuration = 300;

export default async function QuestionPage({
  params,
  searchParams,
}: PageProps<"/questions/[questionId]">) {
  const user = await requireUser();
  const { questionId } = await params;
  const query = await searchParams;
  const sessionId =
    typeof query.session === "string" && query.session.length > 0 ? query.session : undefined;
  const requested =
    typeof query.attempt === "string" && query.attempt.length > 0 ? query.attempt : undefined;

  const question = await orNotFound(requireQuestion(user.id, questionId));
  const neighbours = await getSheetNeighbours(user.id, questionId);

  // The attempt is created by the browser (see QuestionView), never while rendering:
  // link prefetching would otherwise start attempts for questions nobody opened.
  // Once the newest attempt has been submitted, that attempt stays on screen.
  // `?attempt=<id>` selects one of the user's attempts at this question (an unknown or foreign
  // id is a 404); without it, the newest attempt is shown.
  const newest = await getLatestAttemptFor(user.id, questionId, sessionId);
  const attempt = requested ? await orNotFound(requireAttempt(user.id, requested)) : newest;
  if (attempt && attempt.questionId !== question.id) notFound();
  const working = attempt ? await getWorkingFor(user.id, attempt.id) : null;
  const visible = attempt ? await visibleHintsFor(user.id, attempt.id) : { level: 0, hints: [] };
  const submitted = working?.submittedAt != null;
  // Once the attempt is submitted its evaluation shows the solution; before that, the page does.
  const solution = submitted ? null : await getVisibleSolution(user.id, questionId);
  const dots = submitted
    ? timelineDots(await getQuestionTimeline(user.id, questionId, sessionId), attempt?.id ?? null)
    : [];
  const suffix = sessionId ? `?session=${sessionId}` : "";
  const hintsReady = question.hintsStatus === "ready";
  const [sheet] = question.sheetId
    ? await db.select().from(sheets).where(eq(sheets.id, question.sheetId))
    : [];
  const timerEnabled = sheet?.timerEnabled ?? true;
  const hasOfficial = (await officialQuestionIds([question.id])).length > 0;

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={question.hintsStatus === "pending"} />
      <PageHeader
        back={
          neighbours.sheetId
            ? { href: `/sheets/${neighbours.sheetId}`, label: "Back to the sheet" }
            : undefined
        }
        title={
          <>
            Question {question.label}
            <span className="text-muted-foreground ml-3 font-sans text-sm font-normal tracking-normal">
              {neighbours.position} of {neighbours.total} · about {question.expectedMinutes} min
            </span>
          </>
        }
      />

      <Panel className="border-foreground/80 border-t-2 px-6 py-5">
        <MathText className="font-heading text-[17px] leading-relaxed">{question.body}</MathText>
      </Panel>

      <QuestionView
        // A different attempt is a different draft: start its state afresh.
        key={attempt?.id ?? "none"}
        questionId={question.id}
        sessionId={sessionId}
        initialAttemptId={attempt?.id ?? null}
        initialHints={visible.hints}
        hintsReady={hintsReady}
        timerEnabled={timerEnabled}
        markWithAi={sheet?.markWithAi ?? true}
        hasOfficial={hasOfficial}
        initialSeconds={attempt?.secondsSpent ?? 0}
        initialRating={attempt?.difficultyRating ?? null}
        initialText={working?.text ?? ""}
        initialFiles={(working?.files ?? []).map((file) => ({ id: file.id, mime: file.mime }))}
        submitted={submitted}
        timeline={<AttemptTimeline dots={dots} questionId={question.id} sessionId={sessionId} />}
        newestHref={
          attempt && newest && attempt.id !== newest.id ? `/questions/${questionId}${suffix}` : null
        }
        prevHref={neighbours.prevId ? `/questions/${neighbours.prevId}${suffix}` : null}
        nextHref={neighbours.nextId ? `/questions/${neighbours.nextId}${suffix}` : null}
      >
        {submitted && attempt ? (
          <AttemptEvaluation
            userId={user.id}
            question={question}
            attemptId={attempt.id}
            sessionId={sessionId}
          />
        ) : null}
      </QuestionView>

      {solution ? <SolutionPanel solution={solution} /> : null}
    </section>
  );
}
