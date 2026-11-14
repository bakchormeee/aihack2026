// Answering a spot-the-error question (SPEC-spot-the-error.md): check the answer, take
// the student's one answer, have the AI judge the explanations of the lines that really
// contain a planted error, and work out the outcome in code.

import {
  claimSpotAnswer,
  finishSpotAnswer,
  loadSpotItem,
  releaseSpotAnswer,
  startSpotAnswer,
} from "@/db/queries/spot";
import { judgeSpotAnswer } from "@/lib/ai/judge-spot-answer";
import type { Outcome, SpotTick } from "@/lib/domain";
import { checkAnswer, spotOutcome } from "@/lib/spot/rules";

export type SpotAnswerIo = { judge: typeof judgeSpotAnswer };

const defaultIo: SpotAnswerIo = { judge: judgeSpotAnswer };

export type SpotAnswerResult = { ok: true; outcome: Outcome } | { ok: false; error: string };

export async function answerSpotItem(
  userId: string,
  sessionId: string,
  position: number,
  input: { noError: boolean; ticked: SpotTick[] },
  io: SpotAnswerIo = defaultIo,
  now: Date = new Date(),
): Promise<SpotAnswerResult> {
  const { item } = await loadSpotItem(userId, sessionId, position);

  const problem = checkAnswer(item.lines.length, input);
  if (problem) return { ok: false, error: problem };

  const ticked = input.ticked.map((t) => ({ line: t.line, explanation: t.explanation.trim() }));
  await startSpotAnswer(userId, item.id);
  if (!(await claimSpotAnswer(item.id, { noError: input.noError, ticked }, now)))
    return { ok: false, error: "You have already answered this question." };

  const planted = item.planted.map((p) => p.line);
  const toJudge = ticked.filter((t) => planted.includes(t.line));
  let judgements: Awaited<ReturnType<SpotAnswerIo["judge"]>> = [];
  if (toJudge.length > 0) {
    try {
      judgements = await io.judge({
        question: item.body,
        lines: toJudge.map((t) => {
          const error = item.planted.find((p) => p.line === t.line)!;
          return {
            line: t.line,
            text: item.lines[t.line - 1],
            whatsWrong: error.whatsWrong,
            correctLine: error.correctLine,
            explanation: t.explanation,
          };
        }),
      });
    } catch (error) {
      console.error(`judging spot answer ${item.id} failed`, error);
      await releaseSpotAnswer(item.id);
      return { ok: false, error: "We could not check your answer just now. Please try again." };
    }
  }

  const outcome = spotOutcome({
    planted,
    ticked: ticked.map((t) => t.line),
    noError: input.noError,
    explained: Object.fromEntries(judgements.map((j) => [j.line, j.right])),
  });
  await finishSpotAnswer(item.id, judgements, outcome);
  return { ok: true, outcome };
}
