import Link from "next/link";

import { MathText } from "@/components/math-text";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader, Panel } from "@/components/page-parts";
import { buttonVariants } from "@/components/ui/button";
import { SpotAnswerForm } from "@/components/spot-answer-form";
import { SpotReveal } from "@/components/spot-reveal";
import {
  getSpotSession,
  isAnswered,
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
  // An answer the server never finished judging counts as not given (see isAnswered).
  const answered = isAnswered(answer);
  const sessionHref = `/revise/${session.id}`;
  // The planted errors and their corrections are only sent to the browser once answered.
  const descriptions = answered
    ? await misconceptionDescriptions(item.planted.map((p) => p.misconceptionId))
    : new Map<string, string>();
  // Fewer questions than asked for exist when some could not be written.
  const count = (await getSpotSession(user.id, session.id)).items.length;
  const nextHref = item.position < count ? `${sessionHref}/spot/${item.position + 1}` : sessionHref;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        back={{ href: sessionHref, label: "Back to the session" }}
        title={`Spot the error: question ${item.position} of ${count}`}
      />
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i + 1 < item.position ? "bg-foreground/70" : i + 1 === item.position ? "bg-pen" : "bg-muted"}`}
          />
        ))}
      </div>

      <Panel className="border-foreground/80 border-t-2 px-6 py-5">
        <MathText className="font-heading text-[17px] leading-relaxed">{item.body}</MathText>
      </Panel>

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
          <div className="flex justify-end border-t pt-4">
            <Link href={nextHref} className={buttonVariants({ className: "group" })}>
              {item.position < count ? "Next question" : "Finish"}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
          </div>
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
