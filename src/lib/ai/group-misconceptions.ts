// groupMisconceptions: place a student's new mistakes into their list of common
// errors ("misconceptions"), reusing an existing one when it is the same error and
// creating a new one otherwise (SPEC-spot-the-error.md). Mistakes and misconceptions
// are referred to by number or short id, never by database id.

import { z } from "zod";

import type { ErrorType } from "@/lib/domain";
import { mathIsDelimited } from "@/lib/marking/math-check";

import { callAi } from "./client";
import { MATH_FORMAT } from "./prompt";

const text = z.string().trim().min(1);

export const groupMisconceptionsSchema = z
  .object({
    // Misconceptions that are not in the existing list yet. Each has a key used by the placements.
    newMisconceptions: z.array(z.object({ key: text, description: text })).max(40),
    placements: z
      .array(
        z.object({
          // The number of the mistake, as listed in the request.
          mistake: z.number().int(),
          // The short id of an existing misconception, or null when `key` names a new one.
          existing: z.string().nullable(),
          key: z.string().nullable(),
        }),
      )
      .max(80),
  })
  .superRefine((reply, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const keys = new Set(reply.newMisconceptions.map((m) => m.key));
    if (keys.size !== reply.newMisconceptions.length)
      fail("Each new misconception needs its own key.", ["newMisconceptions"]);
    reply.newMisconceptions.forEach((m, i) => {
      if (!mathIsDelimited(m.description))
        fail("Write all maths in the description as LaTeX inside $…$.", [
          "newMisconceptions",
          i,
          "description",
        ]);
    });
    reply.placements.forEach((p, i) => {
      if ((p.existing === null) === (p.key === null))
        fail("Give either an existing misconception or a new key, not both and not neither.", [
          "placements",
          i,
        ]);
      if (p.key !== null && !keys.has(p.key))
        fail(`"${p.key}" is not listed in newMisconceptions.`, ["placements", i, "key"]);
    });
  });

const SYSTEM = `You keep a list of one university mathematics student's common errors, called misconceptions. You receive the student's existing misconceptions and a numbered list of their new mistakes, each with its kind, the quoted step and the topics it was made in.

Place every new mistake that shows a recurring error, either in an existing misconception or in a new one.
- A misconception is one specific, repeatable error in how the student thinks or works, written as one sentence with a short example in maths. For example: "Removes a bracket after a minus sign without changing the signs inside it, e.g. writes $3-(2+8)$ as $3-2+8$." It is not a topic ("integration") and not a vague habit ("careless").
- It must be specific enough that a question could be written which tempts the student into exactly this error, and general enough to apply to other questions: describe the kind of step, not this question. Do not mention the particular sequence, function, numbers or answer of the question the mistake came from. Keep the example tiny and generic.
- Reuse an existing misconception whenever the new mistake is the same error, even if the quote and the topic differ. Also reuse one marked hidden: the student has chosen to hide it, and a mistake like it belongs there.
- Create a new misconception only when the mistake is a different error from every existing one. Give it a short key of your own (such as "n1", "n2") in "newMisconceptions" and use that key in the placements. Several mistakes that are the same new error share one key.
- Leave a mistake out of "placements" if it is a one-off, a plain typing slip, or too vague to describe as a repeatable error.
- Describe the error itself, not the student, and never include the question's answer.

Reply with "newMisconceptions" and "placements". Each placement gives the number of a mistake and either the short id of an existing misconception ("existing") or the key of a new one ("key"), with the other set to null.

${MATH_FORMAT}
- Every piece of mathematics in a description must be inside $…$.`;

export type ExistingMisconception = { id: string; description: string; hidden: boolean };
export type NumberedMistake = { n: number; type: ErrorType; quote: string; topics: string[] };

export type Placement =
  { mistake: number; existing: string } | { mistake: number; description: string };

export async function groupMisconceptions(i: {
  existing: ExistingMisconception[];
  mistakes: NumberedMistake[];
}): Promise<Placement[]> {
  const known = i.existing.length
    ? i.existing.map((m) => `${m.id}${m.hidden ? " (hidden)" : ""}: ${m.description}`).join("\n")
    : "(none yet)";
  const mistakes = i.mistakes
    .map(
      (m) =>
        `${m.n}. [${m.type}] ${m.quote}${m.topics.length ? ` (topics: ${m.topics.join(", ")})` : ""}`,
    )
    .join("\n");

  const reply = await callAi({
    callName: "groupMisconceptions",
    schema: groupMisconceptionsSchema,
    system: SYSTEM,
    text: `Existing misconceptions:\n${known}\n\nNew mistakes:\n${mistakes}\n\nPlace the new mistakes.`,
  });

  const wanted = new Set(i.mistakes.map((m) => m.n));
  const known_ids = new Set(i.existing.map((m) => m.id));
  const descriptions = new Map(reply.newMisconceptions.map((m) => [m.key, m.description]));
  const placements: Placement[] = [];
  const seen = new Set<number>();
  for (const p of reply.placements) {
    if (!wanted.has(p.mistake) || seen.has(p.mistake)) continue; // an invented or repeated number
    if (p.existing !== null) {
      if (!known_ids.has(p.existing)) continue; // an invented id
      placements.push({ mistake: p.mistake, existing: p.existing });
    } else {
      placements.push({ mistake: p.mistake, description: descriptions.get(p.key!)! });
    }
    seen.add(p.mistake);
  }
  return placements;
}
