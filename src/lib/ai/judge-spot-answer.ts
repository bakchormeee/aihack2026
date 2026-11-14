// judgeSpotAnswer: decide whether a student's explanation of a line they ticked
// correctly identifies the error planted in it (SPEC-spot-the-error.md). Only ticked
// lines that really contain a planted error are sent; matching the lines themselves is
// done in code, not here.

import { z } from "zod";

import { mathIsDelimited } from "@/lib/marking/math-check";

import { callAi } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

export const judgeSpotAnswerSchema = z
  .object({
    judgements: z
      .array(z.object({ line: z.number().int().min(1), right: z.boolean(), comment: text }))
      .max(2),
  })
  .superRefine((reply, ctx) => {
    reply.judgements.forEach((j, i) => {
      if (!mathIsDelimited(j.comment))
        ctx.addIssue({
          code: "custom",
          message: "Write all maths in the comment as LaTeX inside $…$.",
          path: ["judgements", i, "comment"],
        });
    });
  });

const SYSTEM = `You are a fair marker of university mathematics. A student was shown a worked solution with errors deliberately planted in it, and ticked some lines they think are wrong, each with a short explanation. For each line you receive the line as written, the error that was planted in it (what is wrong and the correct line), and the student's explanation.

For each line, decide whether the student's explanation correctly identifies the error.
- It is right when it says what is wrong in the line in a way that matches the planted error, even in different words, with different notation, or with only the key idea. A correct statement of how the line should read also counts.
- It is wrong when it names a different problem, is vague ("this looks wrong", "the algebra is off"), only restates the line, or gives a wrong reason, even though the line itself is the one with the error.
- Do not give credit for a correct explanation of something else, and do not penalise untidy wording or spelling.
- "comment" is one sentence to the student about their explanation: what they got right, or what was missing. You may refer to the planted error, because the answer is shown to them afterwards.

Return one judgement for every line you receive, with its line number.

${MATH_FORMAT}
- Every piece of mathematics in "comment" must be inside $…$.`;

export type JudgeInput = {
  question: string;
  lines: {
    line: number;
    text: string;
    whatsWrong: string;
    correctLine: string;
    explanation: string;
  }[];
};
export type Judgement = { line: number; right: boolean; comment: string };

export async function judgeSpotAnswer(i: JudgeInput): Promise<Judgement[]> {
  const lines = i.lines
    .map(
      (l) =>
        `Line ${l.line}: ${l.text}\nPlanted error: ${l.whatsWrong}\nCorrect version: ${l.correctLine}\nStudent's explanation: ${l.explanation}`,
    )
    .join("\n\n");

  const reply = await callAi({
    callName: "judgeSpotAnswer",
    schema: judgeSpotAnswerSchema,
    system: SYSTEM,
    text: `Question:\n\n${i.question}\n\n${lines}\n\nJudge the explanations.`,
  });

  // One judgement per requested line: a line the model skipped, or repeated, is handled here.
  return i.lines.map(({ line }) => {
    const found = reply.judgements.find((j) => j.line === line);
    return found ?? { line, right: false, comment: "This explanation could not be judged." };
  });
}
