import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { QuestionView } from "@/components/question-view";
import { findOpenAttemptFor, getSheetNeighbours, visibleHintsFor } from "@/db/queries/attempts";
import { orNotFound } from "@/lib/auth/guards";
import { requireQuestion } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

export default async function QuestionPage({
  params,
  searchParams,
}: PageProps<"/questions/[questionId]">) {
  const user = await requireUser();
  const { questionId } = await params;
  const rawSession = (await searchParams).session;
  const sessionId =
    typeof rawSession === "string" && rawSession.length > 0 ? rawSession : undefined;

  const question = await orNotFound(requireQuestion(user.id, questionId));
  const neighbours = await getSheetNeighbours(user.id, questionId);

  // The attempt is created by the browser (see QuestionView), never while rendering:
  // link prefetching would otherwise start attempts for questions nobody opened.
  const attempt = await findOpenAttemptFor(user.id, questionId, sessionId);
  const visible = attempt ? await visibleHintsFor(user.id, attempt.id) : { level: 0, hints: [] };
  const query = sessionId ? `?session=${sessionId}` : "";
  const hintsReady = question.hintsStatus === "ready";

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={question.hintsStatus === "pending"} />
      <div>
        {neighbours.sheetId ? (
          <Link
            href={`/sheets/${neighbours.sheetId}`}
            className="text-muted-foreground text-sm underline"
          >
            Back to the sheet
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold">
          Question {question.label}
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {neighbours.position} of {neighbours.total} · about {question.expectedMinutes} min
          </span>
        </h1>
      </div>

      <div className="rounded-lg border p-4">
        <MathText>{question.body}</MathText>
      </div>

      <QuestionView
        questionId={question.id}
        sessionId={sessionId}
        initialAttemptId={attempt?.id ?? null}
        initialHints={visible.hints}
        hintsReady={hintsReady}
        prevHref={neighbours.prevId ? `/questions/${neighbours.prevId}${query}` : null}
        nextHref={neighbours.nextId ? `/questions/${neighbours.nextId}${query}` : null}
      />
    </section>
  );
}
