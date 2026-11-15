// matchWorking: find which part of which photo answers which question, for working
// uploaded for several questions at once (SPEC-batch-working.md section 2). Returns
// boxes as fractions of the photo and a question label, or null for working it
// cannot place. The caller maps labels to questions (groupProposal in
// src/lib/batch/regions.ts) and the student checks everything before it is used.

import { z } from "zod";

import type { ProposedRegion } from "@/lib/batch/regions";

import { callAi, type AiFile } from "./client";

export const matchWorkingSchema = z.object({
  regions: z.array(
    z.object({
      // Which photo the region is on, counting from 0 in the order the photos are attached.
      photo: z.number().int().min(0),
      // Top-left corner and size, each a fraction 0-1 of the photo's width or height.
      box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      questionLabel: z.string().trim().min(1).nullable(),
    }),
  ),
});

const SYSTEM = `You help a university mathematics student who has photographed their handwritten working for several questions of a problem sheet. You receive the photos and the sheet's questions, each with its label and its text. Your task is to find, on the photos, the working for each question. You do not mark or judge the working.

How to match
- First use the question numbers the student wrote: "3", "Q3", "3.", "Question 4(a)", "(b)" under a "4", and so on. A label on the page matches a question when it means the same label, for example "Q4(a)" matches "4(a)" and "4a".
- When no number is written, match by what the working is about: the functions, matrices, integrals or other objects in the question text.
- Working you cannot place with confidence is unmatched: give it "questionLabel": null. Never guess a question.
- Only use the labels given in the request. Working for a question that is not listed is unmatched.
- A question's working may continue in another place on the same photo or on another photo. Return one region for each separate piece, in the order the student wrote them.
- Leave out empty paper, printed text that is not the student's working, and crossed-out scraps.

Each region
- "photo": the photo it is on, counting from 0 in the order the photos are attached.
- "box": "x" and "y" are the top-left corner, "w" and "h" the width and height, each as a fraction from 0 to 1 of that photo's width or height. Draw the box around all of that piece of working, including its question number, and do not cut through lines of writing. Boxes of different questions should not overlap.
- "questionLabel": the label of the question exactly as it is written in the request, or null when unmatched.

Return an empty list when the photos hold no working.`;

export async function matchWorking(i: {
  photos: AiFile[];
  questions: { label: string; body: string }[];
}): Promise<ProposedRegion[]> {
  if (i.photos.length === 0 || i.questions.length === 0) return [];

  const questions = i.questions
    .map((q) => `Question label: ${q.label}\n\n${q.body}`)
    .join("\n\n---\n\n");
  const text = [
    `${i.photos.length} photo${i.photos.length === 1 ? " is" : "s are"} attached, numbered from 0 in the order they are attached.`,
    `The questions of the sheet that can take working:\n\n${questions}`,
    "Find the working for each question on the photos.",
  ].join("\n\n");

  const result = await callAi({
    callName: "matchWorking",
    schema: matchWorkingSchema,
    system: SYSTEM,
    text,
    files: i.photos,
  });
  return result.regions;
}
