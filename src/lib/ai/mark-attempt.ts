// markAttempt: mark a student's working against a worked solution (contract C2,
// as changed by SPEC-marking-v2.md). Returns a score out of 5 and the list of
// mistakes, never an outcome: the outcome is derived from the score by
// `outcomeFromScore` in src/lib/marking/rules.ts.

import { z } from "zod";

import { ERROR_TYPES, type Mistake, type MistakeLocation } from "@/lib/domain";
import { mathIsDelimited } from "@/lib/marking/math-check";
import { severityOf } from "@/lib/marking/rules";

import { callAi, type AiFile } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);
const MAX_MISTAKES = 8;

const rawMistake = z.object({
  type: z.enum(ERROR_TYPES),
  quote: text,
  hint: text,
  // Which attached file the mistake is in (0 is the first file), or null for typed working.
  fileIndex: z.number().int().nullable(),
  // For a PDF: the page number, starting at 1.
  page: z.number().int().nullable(),
  // For a photo: the step's position as fractions 0-1 of the image, from the top-left corner.
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
});

export const markAttemptSchema = z
  .object({
    score: z.number().int().min(0).max(5),
    mistakes: z.array(rawMistake).max(MAX_MISTAKES),
    feedback: text,
    overallFeedback: text,
  })
  .superRefine((mark, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: "custom", message, path });
    const careless = mark.mistakes.filter((m) => severityOf(m.type) === "careless").length;
    const structural = mark.mistakes.length - careless;

    // The score must agree with the mistakes it lists (the scheme in SYSTEM below).
    if (mark.score === 5 && mark.mistakes.length > 0) {
      fail("A score of 5 means fully correct: list no mistakes.", ["mistakes"]);
    }
    if (mark.score === 4 && (structural > 0 || careless < 1 || careless > 2)) {
      fail("A score of 4 needs one or two careless slips and no structural mistake.", ["mistakes"]);
    }
    if (mark.score >= 1 && mark.score <= 3 && mark.mistakes.length === 0) {
      fail("A score of 1 to 3 needs at least one listed mistake.", ["mistakes"]);
    }

    // Every text the student sees must keep its maths inside dollar signs, so it renders.
    const dollars = "write all maths as LaTeX inside $…$ and keep ordinary words outside";
    const check = (value: string, path: (string | number)[]) => {
      if (!mathIsDelimited(value))
        fail(`This text has maths outside dollar signs: ${dollars}.`, path);
    };
    check(mark.feedback, ["feedback"]);
    check(mark.overallFeedback, ["overallFeedback"]);
    mark.mistakes.forEach((m, i) => {
      check(m.quote, ["mistakes", i, "quote"]);
      check(m.hint, ["mistakes", i, "hint"]);
    });
  });

const SYSTEM = `You are an experienced, fair marker of university mathematics. You mark one student's working for one question. You receive the question, a reference solution, and the student's working as typed text, as photos or scans of handwriting or PDF pages, or a mixture.

How to mark
- Read the working line by line and check each step on its own merits. Judge the mathematics, not the resemblance to the reference solution.
- Accept any valid alternative method. A different method, a different order of steps, different notation or an equivalent form of the answer is correct when the mathematics is correct and answers the question that was asked. Use the reference solution to know the right result and one correct route, not as the only acceptable route.
- Ignore anything the student has crossed out. If handwriting is ambiguous, read it in the way that makes mathematical sense in context. Do not penalise handwriting, layout or untidiness. If part of it truly cannot be read, say which part in the feedback and mark what you can read.
- Do not give credit for steps that are not in the working. A correct final answer with no supporting working earns at most 2, unless the question asks only for a value.
- After a slip, later steps that are correct given the slip keep their credit.

"score": a whole number from 0 to 5, using this scheme exactly
5 = fully correct.
4 = right structure, with 1 or 2 careless slips. This counts as correct.
3 = right approach, but a structural gap, or 3 or more careless slips.
2 = a sound start, then a structural error.
1 = only a relevant idea.
0 = blank, off-topic or for a different question.

Kinds of mistake ("type" of each mistake). Careless slips cost less than structural errors:
- algebra_slip (careless): a sign or algebra error inside an otherwise correct method, for example a dropped minus sign or a wrongly expanded bracket.
- arithmetic_slip (careless): wrong arithmetic, or a number copied wrongly from one line to the next.
- notation (careless): a wrong symbol or a missing bracket where the intended meaning is clear.
- conceptual (structural): a misunderstanding of a definition, theorem or idea, or a method that cannot work.
- method (structural): a suitable idea applied wrongly, or a wrong choice in setting it up.
- incomplete (structural): a needed step, case or justification is missing, or the argument stops early.
- misread_question (structural): an answer to a different question from the one asked, or wrong given data.
A 4 may list only careless mistakes, one or two of them. A 5 lists none.

"mistakes": every mistake in the working, in the order it occurs. Give an empty list only for a 5, or for a 0 where there is nothing to point at. For each mistake:
- "quote": the student's own words and symbols at that step, copied exactly. Write ordinary words as plain text and put every piece of mathematics in $…$.
- "hint": one or two sentences telling the student what to check at that step. NEVER give the corrected step, the correct value, the correct expression or the final answer: say what is wrong or where to look, and let the student fix it. For example, say "Check the sign when you integrate $\\sin x$", never "It should be $-\\cos x$".
- "fileIndex": which attached file the step is in, counting from 0 in the order the files are listed in the request; null when the working is typed.
- "page": for a PDF, the page number counting from 1; otherwise null.
- "box": for a photo, where that step is: "x" and "y" are the top-left corner and "width" and "height" the size, each as a fraction from 0 to 1 of the image width or height (for example x 0.1, y 0.4, width 0.5, height 0.07). Draw the box around the whole written line of that step. Null for typed working and for PDFs.

"feedback": 2 to 4 sentences addressed to the student as "you". Say what is right, then what to check and why, without correcting it. Never write out the corrected solution or the final answer: the student will retry the question.
"overallFeedback": one or two sentences that sum up the attempt and give one piece of advice for next time.
For a fully correct answer, confirm that it is correct and mention one thing done well.

If the request says the student asked for a re-mark, mark the same working again from the start with an open mind. Consider the student's reason carefully and check again for a valid alternative method and for misread handwriting. Change the mark if the reason is right; keep it if the working is still wrong, and explain in the feedback what to check. A reason is not working: it cannot add steps that are not on the page.

${MATH_FORMAT}
- Every piece of mathematics in "quote", "hint", "feedback" and "overallFeedback" must be inside $…$. Never leave a LaTeX command, a power or a subscript outside dollar signs.`;

export type MarkResult = {
  score: number;
  mistakes: Mistake[];
  feedback: string;
  overallFeedback: string;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function locate(raw: z.infer<typeof rawMistake>, files: AiFile[]): MistakeLocation {
  const file = raw.fileIndex === null ? undefined : files[raw.fileIndex];
  if (raw.fileIndex === null || !file) return { kind: "text" };

  if (file.mime === "application/pdf") {
    return {
      kind: "pdf",
      fileIndex: raw.fileIndex,
      page: raw.page !== null && raw.page >= 1 ? raw.page : 1,
    };
  }
  if (!raw.box) return { kind: "text" }; // a photo without a position is listed, not drawn

  // Cut the box to the part inside the image, whatever the model said.
  const left = clamp(raw.box.x, 0, 1);
  const top = clamp(raw.box.y, 0, 1);
  const right = clamp(raw.box.x + raw.box.width, 0, 1);
  const bottom = clamp(raw.box.y + raw.box.height, 0, 1);
  const x = left;
  const y = top;
  const width = right - left;
  const height = bottom - top;
  if (width < 0.005 || height < 0.005) return { kind: "text" };
  return { kind: "image", fileIndex: raw.fileIndex, box: { x, y, width, height } };
}

export async function markAttempt(i: {
  questionBody: string;
  solution: string;
  working: { text: string | null; files: AiFile[] };
  disputeReason?: string;
}): Promise<MarkResult> {
  const typed = i.working.text?.trim();
  const files = i.working.files;
  const sections = [
    `Question:\n\n${i.questionBody}`,
    `Reference solution (the student has not seen it):\n\n${i.solution}`,
    typed ? `Student's typed working:\n\n${typed}` : "The student typed no working.",
    files.length > 0
      ? `The student's written working is attached as ${files.length} file${files.length === 1 ? "" : "s"}, in this order: ${files
          .map(
            (file, index) => `file ${index} (${file.mime === "application/pdf" ? "PDF" : "photo"})`,
          )
          .join(", ")}.`
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
    files,
  });
  return {
    score: mark.score,
    mistakes: mark.mistakes.map((m) => ({
      type: m.type,
      quote: m.quote,
      hint: m.hint,
      location: locate(m, files),
    })),
    feedback: mark.feedback,
    overallFeedback: mark.overallFeedback,
  };
}
