import Link from "next/link";

import { MathText } from "@/components/math-text";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonVariants } from "@/components/ui/button";
import { SpotAnswerForm } from "@/components/spot-answer-form";
import { SpotReveal } from "@/components/spot-reveal";
import {
  getSpotSession,
  loadSpotItem,
  misconceptionDescriptions,
  startSpotAnswer,
} from "@/db/queries/spot";
import { orNotFound } from "@/lib/auth/guards";
import { requireUser } from "@/lib/auth/session";

// Judging the explanations calls the AI, which can take a little while.
export const maxDuration = 120;

export default async function SpotQuestionPage({
  params,
}: PageProps<"/revise/[sessionId]/spot/[position]">) {
  const user = await requireUser();
  const { sessionId, position: raw } = await params;
  const position = Number(raw);
  const { session, item, answer } = await orNotFound(
    loadSpotItem(user.id, sessionId, Number.isInteger(position) ? position : -1),
  );
  // The time spent counts from the first visit to the question.
  if (!answer) await startSpotAnswer(user.id, item.id);
  const answered = answer?.answeredAt !== null && answer?.answeredAt !== undefined;
  const sessionHref = `/revise/${session.id}`;
  // The planted errors and their corrections are only sent to the browser once answered.
  const descriptions = answered
    ? await misconceptionDescriptions(item.planted.map((p) => p.misconceptionId))
    : new Map<string, string>();
  const count = answered ? (await getSpotSession(user.id, session.id)).items.length : 0;
  const nextHref = item.position < count ? `${sessionHref}/spot/${item.position + 1}` : sessionHref;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link href={sessionHref} className="text-muted-foreground text-sm underline">
          Back to the session
        </Link>
        <h1 className="text-xl font-semibold">
          Spot the error: question {item.position} of {session.questionCount}
        </h1>
      </div>

      <div className="rounded-lg border p-4">
        <MathText className="text-sm">{item.body}</MathText>
      </div>

      {answered && answer && answer.outcome ? (
        <>
          <SpotReveal
            lines={item.lines}
            planted={item.planted.map((p) => ({
              line: p.line,
              whatsWrong: p.whatsWrong,
              correctLine: p.correctLine,
              misconception: descriptions.get(p.misconceptionId) ?? "",
            }))}
            ticked={answer.ticked}
            judgements={answer.judgements}
            noError={answer.noError}
            outcome={answer.outcome}
          />
          <Link href={nextHref} className={buttonVariants({ className: "self-start" })}>
            {item.position < count ? "Next question" : "Finish"}
          </Link>
        </>
      ) : answered ? (
        <p className="text-muted-foreground text-sm" role="status">
          Checking your answer…
          <AutoRefresh active />
        </p>
      ) : (
        <SpotAnswerForm sessionId={session.id} position={item.position} lines={item.lines} />
      )}
    </section>
  );
}
