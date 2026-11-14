import Link from "next/link";

import { MathText } from "@/components/math-text";
import { SpotAnswerForm } from "@/components/spot-answer-form";
import { OUTCOME_LABEL } from "@/lib/marking/labels";
import { loadSpotItem, startSpotAnswer } from "@/db/queries/spot";
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

      {answered ? (
        <p className="text-sm" role="status">
          {answer?.outcome ? OUTCOME_LABEL[answer.outcome] : "Checking your answer…"}
        </p>
      ) : (
        <SpotAnswerForm sessionId={session.id} position={item.position} lines={item.lines} />
      )}
    </section>
  );
}
