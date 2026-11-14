// parseSheet: turn an uploaded problem sheet into questions and topics (contract C2).

import { z } from "zod";

import { callAi, type AiFile } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

export const parseSheetSchema = z.object({
  questions: z
    .array(
      z.object({
        label: text,
        body: text,
        topics: z.array(text).min(1).max(3),
        expectedMinutes: z.number().int().min(1).max(180),
      }),
    )
    .min(1),
  newTopics: z.array(
    z.object({
      name: text,
      parent: text.nullable(),
      prerequisites: z.array(text),
    }),
  ),
});

export type ParsedSheet = z.infer<typeof parseSheetSchema>;

const SYSTEM = `You convert a university mathematics problem sheet into structured data. The sheet is attached as a PDF or as page images, in reading order.

Questions
- Return every question on the sheet, in the order it appears. Do not solve anything, and do not add, drop, reorder or rephrase questions.
- A question is the unit a student gets hints for, answers and has marked on its own. Make every lettered part (a), (b), … its own question, and split numbered sub-parts (i), (ii), … the same way, so that each part can be attempted, hinted and marked separately. A numbered question with no parts is a single question.
- "label" is the number as printed, joined to the part letters as printed: "1" for an undivided question, "2(a)" and "2(b)" for its parts, "3(a)(i)" and "3(a)(ii)" for the sub-parts of part (a). If the sheet has no numbers, number the questions 1, 2, 3, ….
- Do not split a part just because it asks for several items in one sentence, for example "compute these five gcds": that stays one question.
- "body" is the complete text of that one question, transcribed faithfully, and it must make sense on its own. Begin with the introduction that the question's parts share (the text before (a), and the text before (i) if the part has sub-parts), including definitions and given data, then the part's own text. Do not include the text of the other parts. Leave out marks, page headers and footers. If the question depends on a figure, describe the figure in one sentence in italics.
- "expectedMinutes" is a whole number: the time a well-prepared student needs to write a full answer. Typical values are 3 to 30.

Topics
- Give each question 1 to 3 topics. A topic is a skill at the level of a lecture section, such as "Integration by parts" or "Eigenvalues and eigenvectors": not as broad as "Calculus", not as narrow as one question.
- You receive the course's existing topics. Use an existing topic, with exactly the spelling given, whenever it fits. Create a new topic only when no existing topic fits.
- List each new topic once in "newTopics". "parent" is the broader topic it belongs under (an existing topic, another new topic, or a short new name such as "Integration"), or null. "prerequisites" are topics, existing or new, that a student should master first; use an empty list when there are none. Never list an existing topic in "newTopics".

${MATH_FORMAT}`;

const key = (name: string) => name.trim().toLowerCase();

/**
 * Make the topic names consistent, so that the caller can save them as they are:
 * a name that matches an existing topic (in any letter case) takes the existing
 * spelling and is not reported as new, and every other topic a question uses
 * is reported in `newTopics`.
 */
function reconcileTopics(parsed: ParsedSheet, existingTopics: string[]): ParsedSheet {
  const existing = new Map(existingTopics.map((name) => [key(name), name]));
  const canonical = (name: string) => existing.get(key(name)) ?? name.trim();

  const newTopics = new Map<string, ParsedSheet["newTopics"][number]>();
  for (const topic of parsed.newTopics) {
    if (existing.has(key(topic.name)) || newTopics.has(key(topic.name))) continue;
    newTopics.set(key(topic.name), {
      name: topic.name.trim(),
      parent: topic.parent === null ? null : canonical(topic.parent),
      prerequisites: topic.prerequisites
        .map(canonical)
        .filter((name) => key(name) !== key(topic.name)),
    });
  }

  const questions = parsed.questions.map((question) => {
    const topics = [...new Set(question.topics.map(canonical))];
    for (const name of topics) {
      if (!existing.has(key(name)) && !newTopics.has(key(name))) {
        newTopics.set(key(name), { name, parent: null, prerequisites: [] });
      }
    }
    return { ...question, topics };
  });

  return { questions, newTopics: [...newTopics.values()] };
}

export async function parseSheet(i: { files: AiFile[]; existingTopics: string[] }): Promise<{
  questions: { label: string; body: string; topics: string[]; expectedMinutes: number }[];
  newTopics: { name: string; parent: string | null; prerequisites: string[] }[];
}> {
  const topics =
    i.existingTopics.length > 0
      ? i.existingTopics.map((name) => `- ${name}`).join("\n")
      : "(none yet: every topic you use is new)";

  const parsed = await callAi({
    callName: "parseSheet",
    schema: parseSheetSchema,
    system: SYSTEM,
    text: `Existing topics of this course:\n${topics}\n\nReturn the questions of the attached problem sheet and any new topics.`,
    files: i.files,
  });
  return reconcileTopics(parsed, i.existingTopics);
}
