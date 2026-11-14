// markAttempt: mark a student's working against a worked solution (contract C2).
// Returns a score, never an outcome: the outcome is derived from the score by
// `outcomeFromScore` in src/lib/marking/rules.ts.

import { z } from "zod";

import { ERROR_TYPES, type ErrorType } from "@/lib/domain";

import { callAi, type AiFile } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

export const markAttemptSchema = z.object({
  score: z.number().int().min(0).max(100),
  errorType: z.enum(ERROR_TYPES).nullable(),
  firstWrongStep: text.nullable(),
  feedback: text,
  overallFeedback: text,
});

const SYSTEM = `You are an experienced, fair marker of university mathematics. You mark one student's working for one question. You receive the question, a reference solution, and the student's working as typed text, as photos or scans of handwriting, or both.

How to mark
- Read the student's working line by line and check each step on its own merits. Judge the mathematics, not the resemblance to the reference solution.
- Accept any valid alternative method. A different method, a different order of steps, different notation or an equivalent form of the answer earns full marks when it is correct and answers the question that was asked. Use the reference solution to know the correct result and one correct route, not as the only acceptable route.
- If handwriting is ambiguous, read it in the way that makes mathematical sense in context. Do not penalise handwriting, layout or untidiness. If a part truly cannot be read, say which part in the feedback and mark what you can read.
- Do not give credit for steps that are not in the working. A correct final answer with no supporting working earns at most half marks, unless the question asks only for a value.
- Follow errors through: after a slip, later steps that are correct given the slip keep most of their credit.
- If the working is blank, off-topic or for a different question, give a score of 0 to 10.

"score": a whole number from 0 to 100
- 90 to 100: a complete and correct answer. Use 100 when there is nothing to fix, and 90 to 99 for a correct answer with a trivial blemish (a missing constant of integration, a lost unit, a small gap in justification).
- 25 to 89: real progress with an error or a gap. Roughly 70 to 89 for a correct method with one slip, 50 to 69 for a correct approach with several errors or a missing part, 25 to 49 for a sensible start that goes wrong early.
- 0 to 24: little or no valid progress.

"firstWrongStep"
- Find the first wrong step: the earliest line of the working that is incorrect, unjustified or missing. Quote that line from the working (in LaTeX) or, if it cannot be quoted, describe exactly where it is. Use null only when the working contains no error and no gap.

"errorType": the kind of error at the first wrong step. Use null when the score is 90 or more. Otherwise use exactly one of:
- conceptual: a misunderstanding of a definition, theorem or idea, or a method that cannot work.
- method: a suitable idea applied wrongly, or a wrong choice in setting it up.
- algebra_slip: a sign or algebra error inside an otherwise correct method.
- arithmetic_slip: wrong arithmetic, or a number copied wrongly from one line to the next.
- notation: a wrong symbol or a missing bracket where the intended meaning is clear.
- misread_question: an answer to a different question from the one asked, or wrong given data.
- incomplete: correct as far as it goes, but stops before the end or leaves out a part.

"feedback": 2 to 5 sentences addressed to the student as "you"
- Anchor the feedback to the first wrong step: first say what is correct up to that point, then say what is wrong at that step and why, then say what to reconsider from there.
- Do not write out the corrected solution and do not state the final answer: the student will retry the question. Point to the error; let the student fix it.
- For a fully correct answer, confirm that it is correct and mention one thing done well.

"overallFeedback": one or two sentences that sum up the attempt and give one piece of advice for next time.

If the request says the student asked for a re-mark, mark the same working again from the start with an open mind. Consider the student's reason carefully and check again for a valid alternative method and for misread handwriting. Change the mark if the reason is right; keep it if the working is still wrong, and explain why in the feedback. A reason is not working: it cannot add steps that are not on the page.

${MATH_FORMAT}`;

export async function markAttempt(i: {
  questionBody: string;
  solution: string;
  working: { text: string | null; files: AiFile[] };
  disputeReason?: string;
}): Promise<{
  score: number;
  errorType: ErrorType | null;
  firstWrongStep: string | null;
  feedback: string;
  overallFeedback: string;
}> {
  const typed = i.working.text?.trim();
  const fileCount = i.working.files.length;
  const sections = [
    `Question:\n\n${i.questionBody}`,
    `Reference solution (the student has not seen it):\n\n${i.solution}`,
    typed ? `Student's typed working:\n\n${typed}` : "The student typed no working.",
    fileCount > 0
      ? `The student's handwritten working is attached as ${fileCount} file${fileCount === 1 ? "" : "s"}, in page order.`
      : "No files are attached.",
  ];
  if (i.disputeReason !== undefined) {
    const reason = i.disputeReason.trim();
    sections.push(
      `The student asked for a re-mark of this working because they think it is right.` +
        (reason ? ` Their reason: "${reason}"` : " They gave no reason."),
    );
  }
  sections.push("Mark the student's working.");

  const mark = await callAi({
    callName: "markAttempt",
    schema: markAttemptSchema,
    system: SYSTEM,
    text: sections.join("\n\n"),
    files: i.working.files,
  });
  // A perfect score has no error to report, whatever the model wrote there.
  return mark.score === 100 ? { ...mark, errorType: null, firstWrongStep: null } : mark;
}
