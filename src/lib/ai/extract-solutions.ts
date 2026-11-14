// extractSolutions: find the official solution of each question in an uploaded
// solutions document (contract C2).

import { z } from "zod";

import { callAi, type AiFile } from "./client";
import { MATH_FORMAT } from "./prompt";

/**
 * The model must answer for every question id. `found` is false, with an
 * empty body, when the document has no solution for that question; such
 * entries are left out of the result of `extractSolutions`.
 */
export const extractSolutionsSchema = z.object({
  solutions: z.array(
    z
      .object({
        questionId: z.string().min(1),
        found: z.boolean(),
        body: z.string(),
      })
      .refine((solution) => !solution.found || solution.body.trim() !== "", {
        message: "a solution that was found must have a body",
        path: ["body"],
      }),
  ),
});

/** The schema for one call: every given id exactly once, and no other id. */
function schemaFor(ids: string[]) {
  return extractSolutionsSchema.superRefine((output, context) => {
    const seen = new Set<string>();
    for (const [index, solution] of output.solutions.entries()) {
      const path = ["solutions", index, "questionId"];
      if (!ids.includes(solution.questionId)) {
        context.addIssue({
          code: "custom",
          path,
          message: `unknown question id "${solution.questionId}"`,
        });
      } else if (seen.has(solution.questionId)) {
        context.addIssue({
          code: "custom",
          path,
          message: `question id "${solution.questionId}" is repeated`,
        });
      }
      seen.add(solution.questionId);
    }
    for (const id of ids) {
      if (!seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["solutions"],
          message: `question id "${id}" is missing`,
        });
      }
    }
  });
}

const SYSTEM = `You match the official solutions of a university mathematics problem sheet to its questions. The solutions document is attached as a PDF or as page images. You also receive the list of questions, each with an id, its label on the sheet and its text.

- Return exactly one entry for every question id in the list, with "questionId" copied exactly as given. Do not invent ids and do not repeat one.
- Match by the label first, and confirm with the content: the solution must answer that question's text. Solutions documents sometimes number questions differently or leave some out.
- "body" is the complete official solution of that question, transcribed faithfully from the document, with all of its steps and all sub-parts (a), (b), … under their labels. Do not shorten it, correct it, complete it or add your own working. Leave out marks, marking notes addressed to markers, page headers and footers.
- If the document contains no solution for a question, set "found" to false and "body" to an empty string. Never write a solution yourself. Otherwise set "found" to true.

${MATH_FORMAT}`;

export async function extractSolutions(i: {
  files: AiFile[];
  questions: { id: string; label: string; body: string }[];
}): Promise<{ solutions: { questionId: string; body: string }[] }> {
  if (i.questions.length === 0) return { solutions: [] };

  // Fixture mode: the fixture's ids are not the caller's ids, so the fixture
  // solutions are given to the caller's questions by position.
  if (process.env.AI_FIXTURES === "1") {
    const fixture = await callAi({
      callName: "extractSolutions",
      schema: extractSolutionsSchema,
      system: SYSTEM,
      text: "",
    });
    const found = fixture.solutions.filter((solution) => solution.found);
    if (found.length === 0) return { solutions: [] };
    return {
      solutions: i.questions.map((question, index) => ({
        questionId: question.id,
        body: found[index % found.length].body,
      })),
    };
  }

  const list = i.questions
    .map(
      (question) =>
        `Question id: ${question.id}\nLabel: ${question.label}\nText:\n${question.body}`,
    )
    .join("\n\n---\n\n");

  const output = await callAi({
    callName: "extractSolutions",
    schema: schemaFor(i.questions.map((question) => question.id)),
    system: SYSTEM,
    text: `Questions of the sheet:\n\n${list}\n\n---\n\nReturn the official solution of every question from the attached solutions document.`,
    files: i.files,
  });

  const byId = new Map(output.solutions.map((solution) => [solution.questionId, solution]));
  return {
    solutions: i.questions.flatMap((question) => {
      const solution = byId.get(question.id);
      return solution?.found ? [{ questionId: question.id, body: solution.body }] : [];
    }),
  };
}
