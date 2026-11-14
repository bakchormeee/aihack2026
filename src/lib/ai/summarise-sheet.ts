// summariseSheet: what went well, what was hard and what to do next, for one
// finished problem sheet (contract C2).

import { z } from "zod";

import type { ErrorType, HintLevel, Outcome } from "@/lib/domain";

import { callAi } from "./client";
import { MATH_FORMAT } from "./prompt";

const points = z.array(z.string().trim().min(1)).max(6);

export const summariseSheetSchema = z.object({
  wentWell: points,
  wasHard: points,
  nextSteps: points,
});

const SYSTEM = `You are a mathematics tutor who writes a short review of one student's work on a university problem sheet. For each question you receive its label, its topics, the outcome of the student's marked attempt, how many of the three hints the student used, the type of error, and the marker's feedback.

Outcomes: "full" is a correct answer, "partial" is real progress with an error or gap, "stuck" is little valid progress. Hints used: 0 means none; 3 means all of them, including the full outline. A full outcome that needed 2 or 3 hints is not yet secure. Error types: conceptual, method, algebra_slip (arithmetic, sign or copying error), misread_question, incomplete.

Write three lists, addressed to the student as "you":
- "wentWell": 1 to 3 points on what the student did well. Prefer questions solved fully with few or no hints, and skills that were right across several questions. Leave the list empty only if nothing went well.
- "wasHard": 1 to 3 points on what was hard. Look for patterns across questions: a topic that needed many hints, an error type that repeats, a step that fails in several places. Leave the list empty if every question was full with at most one hint.
- "nextSteps": 1 to 3 concrete actions for the next study session, most useful first. Each one names what to practise or redo and refers to a topic or a question.

Rules
- Each point is one sentence, specific to this sheet: name the question labels or topics it rests on. No generic study advice and no praise without content.
- Use only the information given. Do not invent details of the student's working, and do not state the answer to any question.
- Be direct and encouraging. Do not repeat a point across lists.

${MATH_FORMAT}`;

export async function summariseSheet(i: {
  items: {
    label: string;
    topics: string[];
    outcome: Outcome;
    hintLevel: HintLevel;
    errorType: ErrorType | null;
    feedback: string;
  }[];
}): Promise<{ wentWell: string[]; wasHard: string[]; nextSteps: string[] }> {
  if (i.items.length === 0) return { wentWell: [], wasHard: [], nextSteps: [] };

  const questions = i.items
    .map((item) =>
      [
        `Question ${item.label}`,
        `Topics: ${item.topics.join(", ") || "none"}`,
        `Outcome: ${item.outcome}`,
        `Hints used: ${item.hintLevel} of 3`,
        `Error type: ${item.errorType ?? "none"}`,
        `Marker's feedback: ${item.feedback}`,
      ].join("\n"),
    )
    .join("\n\n");

  return callAi({
    callName: "summariseSheet",
    schema: summariseSheetSchema,
    system: SYSTEM,
    text: `The student's results on this sheet:\n\n${questions}\n\nWrite the review.`,
  });
}
