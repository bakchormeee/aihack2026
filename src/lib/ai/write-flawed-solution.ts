// writeFlawedSolution: a new question with a worked solution as numbered lines, with
// zero, one or two of the student's own misconceptions planted in it, for
// spot-the-error revision (SPEC-spot-the-error.md). The correct versions of the
// planted lines are returned for the reveal; the student never sees them before answering.

import { z } from "zod";

import { mathIsDelimited } from "@/lib/marking/math-check";

import { callAi } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

export const writeFlawedSolutionSchema = z
  .object({
    body: text,
    // One step per line, in order, not numbered.
    lines: z.array(text).min(3).max(14),
    planted: z
      .array(
        z.object({
          // 1-based number of the line that contains the error.
          line: z.number().int().min(1),
          // The short id (e1, e2) of the misconception this error comes from.
          misconception: text,
          whatsWrong: text,
          correctLine: text,
        }),
      )
      .max(2),
    expectedMinutes: z.number().int().min(1).max(20),
  })
  .superRefine((solution, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const maths = (value: string, path: (string | number)[]) => {
      if (!mathIsDelimited(value))
        fail("Write all maths as LaTeX inside $…$ and keep ordinary words outside.", path);
    };

    maths(solution.body, ["body"]);
    solution.lines.forEach((line, i) => maths(line, ["lines", i]));
    const lines = new Set<number>();
    const ids = new Set<string>();
    solution.planted.forEach((p, i) => {
      if (p.line > solution.lines.length)
        fail("This line number is past the last line.", ["planted", i, "line"]);
      else if (p.correctLine.trim() === solution.lines[p.line - 1].trim())
        fail("The correct line must differ from the line with the error.", [
          "planted",
          i,
          "correctLine",
        ]);
      if (lines.has(p.line)) fail("Two errors cannot be on the same line.", ["planted", i, "line"]);
      if (ids.has(p.misconception))
        fail("Plant each misconception at most once.", ["planted", i, "misconception"]);
      lines.add(p.line);
      ids.add(p.misconception);
      maths(p.whatsWrong, ["planted", i, "whatsWrong"]);
      maths(p.correctLine, ["planted", i, "correctLine"]);
    });
  });

const SYSTEM = `You are a mathematics tutor writing a "find the error" exercise for a university student. You write one new question and a worked solution to it, set out as numbered steps, with some errors deliberately planted in the solution. The student will tick the lines that are wrong and explain each one.

You receive the topics to write on, and a list of misconceptions (e1, e2) to plant, each as a description of a specific error this student tends to make, with an example of it in their own words. You may receive none: then the solution must be completely correct.

The question ("body")
- A new question on the given topics, at the level of a university problem sheet, solvable by hand in a few minutes with a clean result. It should be a question in which the misconception can naturally arise. Do not mention the student, their errors or the exercise.

The solution ("lines")
- Solve the question completely and correctly first, and check it. Then plant exactly the requested errors, one for each misconception, and no others.
- Write one step per line, in order, 4 to 10 lines, each a complete step with its maths. Do not number the lines or write "Step 1".
- Each planted error must show the misconception as the student would make it, in the one line where it happens. It must look natural and plausible, not absurd, and not be signalled in any way (no hints, no hedging words, no "oops").
- Every other line must be correct. Lines after a planted error carry the wrong result forward correctly, so that only the line with the slip is wrong. If there are two errors, plant them in different lines, and not in the first line.
- With no misconception to plant, every line must be correct and no errors are listed.

"planted": one entry for each planted error, with
- "line": the number of the line with the error, counting from 1;
- "misconception": the id (e1 or e2) of the misconception it comes from;
- "whatsWrong": one or two sentences saying what is wrong in that line and why;
- "correctLine": that line written correctly, so that it differs from the line with the error.

"expectedMinutes": a whole number, the minutes a student needs to read the solution and find the errors.

${MATH_FORMAT}
- Every piece of mathematics in "body", "lines", "whatsWrong" and "correctLine" must be inside $…$.`;

export type FlawedSolution = {
  body: string;
  lines: string[];
  /** `misconception` is the short id that was sent in the request (e1, e2). */
  planted: { line: number; misconception: string; whatsWrong: string; correctLine: string }[];
  expectedMinutes: number;
};

export async function writeFlawedSolution(i: {
  /** Names of the topics to write on; empty to write on anything in the course. */
  topics: string[];
  courseName: string;
  /** The misconceptions to plant, with short ids e1, e2. None for a fully correct solution. */
  plant: { id: string; description: string; example: string | null }[];
}): Promise<FlawedSolution> {
  const topics = i.topics.length
    ? i.topics.join(", ")
    : `any topic of the course "${i.courseName}"`;
  const plant = i.plant.length
    ? i.plant
        .map(
          (m) =>
            `${m.id}: ${m.description}${m.example ? ` Example in the student's own words: ${m.example}` : ""}`,
        )
        .join("\n")
    : "(none: write a completely correct solution)";

  const reply = await callAi({
    callName:
      i.plant.length === 0
        ? "writeCleanSolution"
        : i.plant.length === 2
          ? "writeFlawedSolutionTwo"
          : "writeFlawedSolution",
    schema: writeFlawedSolutionSchema,
    system: SYSTEM,
    text: `Topics: ${topics}\n\nMisconceptions to plant:\n${plant}\n\nWrite the question and the solution.`,
  });

  // The count and the ids are checked against the request, which the schema cannot know.
  const wanted = new Set(i.plant.map((m) => m.id));
  const got = reply.planted.map((p) => p.misconception);
  if (got.length !== wanted.size || got.some((id) => !wanted.has(id))) {
    throw new Error(
      `the exercise planted ${got.length} errors (${got.join(", ")}) where ${wanted.size} were asked for`,
    );
  }
  return reply;
}
