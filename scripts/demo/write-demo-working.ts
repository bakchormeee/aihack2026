// writeDemoWorking: a script-only AI call for the demo template (SPEC-demo.md, "The
// demo content"; decision 6 in tasks/plan.md). It writes a student's typed answer to a
// question that reaches a target outcome and shows a chosen mistake naturally. The
// template script submits the text and the real marker marks it. No real student's
// work is used. The app itself never calls this.

import { z } from "zod";

import { callAi } from "@/lib/ai/client";
import { MATH_FORMAT } from "@/lib/ai/prompt";
import type { Outcome } from "@/lib/domain";
import { mathIsDelimited } from "@/lib/marking/math-check";

/** The longest typed working the app accepts (MAX_WORKING_TEXT in src/db/queries/working.ts). */
const MAX_WORKING = 20_000;

/** True when the braces inside every $…$ or $$…$$ piece are balanced (escaped \{ \} aside). */
export function bracesBalanced(text: string): boolean {
  const pieces = text.match(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g) ?? [];
  return pieces.every((piece) => {
    let depth = 0;
    for (const ch of piece.replace(/\\[{}]/g, "")) {
      if (ch === "{") depth++;
      if (ch === "}" && --depth < 0) return false;
    }
    return depth === 0;
  });
}

export const writeDemoWorkingSchema = z
  .object({ working: z.string().trim().min(1).max(MAX_WORKING) })
  .superRefine((reply, ctx) => {
    if (!mathIsDelimited(reply.working))
      ctx.addIssue({
        code: "custom",
        message: "Write all maths as LaTeX inside $…$, and close every dollar sign.",
        path: ["working"],
      });
    else if (!bracesBalanced(reply.working))
      ctx.addIssue({
        code: "custom",
        message: "Balance the braces in every piece of LaTeX.",
        path: ["working"],
      });
  });

const SYSTEM = `You write the typed working of a fictional first-year university mathematics student, for a demonstration of a study app. The app's AI marker will mark it, so it must read like a real student's answer, not like a model solution or a teacher's text.

You receive a question from a problem sheet, the target outcome of this attempt, a mistake the student makes, and the hints the student has already read.

How the working is written
- Typed by the student in a plain text box: short lines and paragraphs, first person where natural ("so", "now", "I think"), no headings, no bold, no bullet lists, no "Solution:". Answer only this question.
- Every piece of mathematics is LaTeX inside $…$ (or $$…$$ for a displayed line), as the student would type it.
- Keep it to the length a student would type: a few lines for a short question, up to about 20 lines for a long one. If the question has parts, answer each part under its label, such as (a) and (b).
- If the student has read hints, the working follows them, as a student who has just read them would.

The target outcome
- "full": a complete and correct answer that would receive full marks. It shows no mistake.
- "partial": a sensible approach that is mostly right, but the given mistake happens at one natural step and leads to a wrong or unjustified result, which the student does not notice. The answer reaches a conclusion.
- "stuck": the student starts sensibly, the given mistake (or confusion close to it) appears early, and the working stops before the end, for example with "not sure how to continue from here". It must not reach a correct final answer.

The mistake
- Show it once or twice, at the step where it naturally arises in this question, written as the student would make it: plausible, not absurd. If the exact mistake cannot arise in this question, show the closest natural form of it.
- Never name the mistake, never hint that it is a mistake, and never correct it later. Do not mention the app, a demonstration, a marker or the outcome.

Return JSON with one field, "working", holding the student's text.

${MATH_FORMAT}`;

export type DemoWorkingInput = {
  questionBody: string;
  outcome: Outcome;
  /** The mistake to show, in words; null for a full attempt. */
  misconception: string | null;
  /** The hints the student read before writing, in order. */
  hintsSeen: string[];
};

export async function writeDemoWorking(i: DemoWorkingInput): Promise<string> {
  const hints = i.hintsSeen.length
    ? i.hintsSeen.map((hint, n) => `Hint ${n + 1}: ${hint}`).join("\n\n")
    : "none";
  const reply = await callAi({
    callName: "writeDemoWorking",
    schema: writeDemoWorkingSchema,
    system: SYSTEM,
    text: [
      `Question:\n\n${i.questionBody}`,
      `Target outcome: ${i.outcome}`,
      `Mistake to show: ${i.misconception ?? "none"}`,
      `Hints seen: ${hints}`,
      "Write the student's working.",
    ].join("\n\n"),
  });
  return reply.working;
}
