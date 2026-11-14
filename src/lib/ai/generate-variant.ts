// generateVariant: a new question on the same topic and method as a parent
// question, with its solution and hints, for revision (contract C2).

import { z } from "zod";

import { callAi } from "./client";
import { HINT_RULES, hintsLeakAnswer } from "./generate-hints";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

// Three named hint fields, as in generate-hints.ts.
export const generateVariantSchema = z.object({
  body: text,
  solution: text,
  finalAnswer: text,
  hint1: text,
  hint2: text,
  hint3: text,
  expectedMinutes: z.number().int().min(1).max(180),
});

const SYSTEM = `You are a mathematics tutor who writes revision questions for a university student. You receive a question from the student's problem sheet (the parent question), its worked solution, and sometimes a note on the error the student made on it. You write one new question, a variant, with its worked solution, final answer and three graded hints.

The variant ("body")
- It tests the same topic and the same method as the parent question, at the same level of difficulty and with about the same amount of work. A student who can solve one should be able to solve the other by the same reasoning.
- It is a different question, not a copy: change the functions, numbers, limits, matrices or setting, so that the parent's answer and intermediate results cannot be reused. Do not only rename variables or reorder parts.
- If a note on the student's error is given, make sure the variant exercises the step where the student went wrong, so that the same mistake would show again. Do not mention the student, the error or the parent question in the text.
- It must be well posed and solvable by hand with the methods of the parent's solution, with a result that comes out cleanly. Keep the parent's structure of parts (a), (b), … if it has one.
- Write it as it would appear on a problem sheet, complete and self-contained.

Worked solution ("solution") and final answer ("finalAnswer")
- Solve your variant completely before you finalise it, and check the result. If it does not work out, change the question. Never return a question you have not solved.
- Write the solution as a model answer with every step shown and justified in a few words.
- "finalAnswer" is the final result only, in its simplest form, as the solution states it. For a question with parts, give the result of each part, separated by semicolons.

"expectedMinutes": a whole number, the time a well-prepared student needs to write a full answer.

Hints (about the variant, not the parent question)
${HINT_RULES}

${MATH_FORMAT}`;

export async function generateVariant(i: {
  parentBody: string;
  parentSolution: string;
  errorSummary: string | null;
}): Promise<{
  body: string;
  solution: string;
  finalAnswer: string;
  hints: [string, string, string];
  expectedMinutes: number;
}> {
  const sections = [
    `Parent question:\n\n${i.parentBody}`,
    `Worked solution of the parent question:\n\n${i.parentSolution}`,
  ];
  const error = i.errorSummary?.trim();
  if (error) sections.push(`The student's error on the parent question:\n\n${error}`);
  sections.push("Write one variant of the parent question.");
  const request = sections.join("\n\n");

  const ask = (text: string) =>
    callAi({ callName: "generateVariant", schema: generateVariantSchema, system: SYSTEM, text });

  let output = await ask(request);
  if (hintsLeakAnswer([output.hint1, output.hint2], output.finalAnswer)) {
    // One regeneration only (contract C2); the second variant is returned as it is.
    output = await ask(
      `${request}\n\nAn earlier variant was rejected because hint1 or hint2 contained the final answer (${output.finalAnswer}). Write a variant again. hint1 and hint2 must not contain the final answer or any expression equal to it.`,
    );
  }
  return {
    body: output.body,
    solution: output.solution,
    finalAnswer: output.finalAnswer,
    hints: [output.hint1, output.hint2, output.hint3],
    expectedMinutes: output.expectedMinutes,
  };
}
