// generateHints: three graded hints, a worked solution and the final answer
// for one question (contract C2). Also `hintsLeakAnswer`, used here and by
// generate-variant.ts.

import { z } from "zod";

import { callAi } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

// Three named fields, not an array: structured output cannot enforce "exactly three".
export const generateHintsSchema = z.object({
  hint1: text,
  hint2: text,
  hint3: text,
  solution: text,
  finalAnswer: text,
});

/** The rules for the three hint levels. Shared with generate-variant.ts. */
export const HINT_RULES = `The three hints are revealed one at a time, in order, to a student who is stuck. Each hint must help more than the one before, and each must make sense on its own.
- hint1 names the relevant concept, theorem or technique only, in one or two sentences. It gives no steps, no substitutions and no formulas applied to this question.
- hint2 gives the strategy and the first step: which method to use, how to set it up for this question, and the first concrete step to carry out. It stops there.
- hint3 is the full outline of the solution without computations: a numbered list of every step in order, saying what to do in each step, but not carrying out the calculations and not stating intermediate or final results.
- hint1 and hint2 must not contain the final answer, in any form: not the value, not an equivalent expression, not as "you should get …". hint3 should not state it either.`;

const SYSTEM = `You are a mathematics tutor who prepares material for one question from a university problem sheet. You write a worked solution, the final answer, and three graded hints.

Worked solution ("solution")
- Solve the question completely and correctly first; everything else depends on it. Check the result (substitute back, differentiate, test a special case) before you write.
- Write the solution as a model answer a student can learn from: every step shown and justified in a few words, display maths for the main steps. If the question has parts (a), (b), …, answer each part under its label.

Final answer ("finalAnswer")
- The final result only, in its simplest form, as the solution states it, for example "$x = 3$" or "$\\frac{\\pi}{4}$". For a question with parts, give the final result of each part, separated by semicolons. For a proof, write a one-line statement of what was shown.

Hints
${HINT_RULES}

${MATH_FORMAT}`;

/** Put a piece of text into a form in which equal maths written differently compares equal. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\(left|right|displaystyle|bigg?[lr]?)(?![a-z])/g, "")
    .replace(/\\[dt]frac/g, "\\frac")
    .replace(/\\(q?quad)(?![a-z])/g, " ")
    .replace(/\\[,;!:> ]/g, " ")
    .replace(/\$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ?([=+\-*/^_{}(),<>]) ?/g, "$1")
    .trim();
}

/** The strings to look for: the whole answer, each maths part, and each right-hand side. */
function answerCandidates(finalAnswer: string): string[] {
  const parts = [finalAnswer];
  for (const match of finalAnswer.matchAll(/\$\$([^$]+)\$\$|\$([^$]+)\$/g)) {
    parts.push(match[1] ?? match[2]);
  }
  const candidates = new Set<string>();
  for (const part of parts) {
    const whole = normalise(part).replace(/[.,;]+$/, "");
    const rightHandSide = whole.slice(whole.lastIndexOf("=") + 1);
    for (const candidate of [whole, rightHandSide]) {
      // A single letter (the name of a variable) says nothing about the answer.
      if (candidate === "" || /^[a-z]$/.test(candidate)) continue;
      candidates.add(candidate);
    }
  }
  return [...candidates];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A pattern that finds `candidate` as a whole term, not inside a longer number, word or expression. */
function wholeTerm(candidate: string): RegExp {
  const before = /^[0-9a-z]/.test(candidate) ? String.raw`(?<![0-9a-z^_{\\\-])(?<!\d\.)` : "";
  const after = /[0-9a-z]$/.test(candidate) ? String.raw`(?![0-9a-z])(?!\.\d)` : "";
  return new RegExp(before + escapeRegExp(candidate) + after);
}

/**
 * True when any of the hints contains the final answer. Callers pass hints 1
 * and 2 only: hint 3 is the full outline and is not checked.
 *
 * The comparison ignores letter case, `$` delimiters, spacing and a few
 * LaTeX spellings (`\dfrac`, `\left`). It cannot recognise an answer written
 * in a different but equal form (for example `0.5` for `\frac{1}{2}`).
 */
export function hintsLeakAnswer(hints: string[], finalAnswer: string): boolean {
  const patterns = answerCandidates(finalAnswer).map(wholeTerm);
  return hints.some((hint) => {
    const normalised = normalise(hint);
    return patterns.some((pattern) => pattern.test(normalised));
  });
}

export async function generateHints(i: { questionBody: string }): Promise<{
  hints: [string, string, string];
  solution: string;
  finalAnswer: string;
}> {
  const request = `Question:\n\n${i.questionBody}\n\nWrite the worked solution, the final answer and the three hints for this question.`;
  const ask = (text: string) =>
    callAi({ callName: "generateHints", schema: generateHintsSchema, system: SYSTEM, text });

  let output = await ask(request);
  if (hintsLeakAnswer([output.hint1, output.hint2], output.finalAnswer)) {
    // One regeneration only (contract C2); the second set is returned as it is.
    output = await ask(
      `${request}\n\nAn earlier set of hints for this question was rejected because hint1 or hint2 contained the final answer (${output.finalAnswer}). Write everything again. hint1 and hint2 must not contain the final answer or any expression equal to it.`,
    );
  }
  return {
    hints: [output.hint1, output.hint2, output.hint3],
    solution: output.solution,
    finalAnswer: output.finalAnswer,
  };
}
