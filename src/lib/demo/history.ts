// The planned history of the demo template student (SPEC-demo.md, "The demo content";
// decision 6 in tasks/plan.md). Pure and deterministic: the same questions and seed
// always give the same plan. The template script follows the plan with the real AI.

import type { Outcome } from "@/lib/domain";

/** The recurring mistakes the template student makes, across sheets and courses. */
export const DEMO_MISCONCEPTIONS = [
  {
    key: "inequality-sign",
    description:
      "Makes a sign error when rearranging an inequality: multiplies or divides both sides by a quantity that can be negative and keeps the direction of the inequality.",
  },
  {
    key: "unchecked-conditions",
    description:
      "Applies a test or theorem (for example a convergence test, or the algebra of limits) without checking that its conditions hold.",
  },
  {
    key: "dropped-case",
    description:
      "Drops a case: argues only for positive values, or only for large $n$, and never deals with the remaining case (negative values, zero, or $n = 1$).",
  },
  {
    key: "examples-as-proof",
    description:
      "Checks a few examples and treats the pattern as proved for every $n$, without a general argument.",
  },
] as const;

export type DemoMisconceptionKey = (typeof DEMO_MISCONCEPTIONS)[number]["key"];

export type DemoQuestion = {
  id: string;
  course: string;
  sheet: 1 | 2;
  topics: string[];
  /** Position on the sheet; questions are ordered by it, then by id. */
  position?: number;
};

export type PlannedAttempt = {
  questionId: string;
  course: string;
  sheet: 1 | 2;
  outcome: Outcome;
  /** The mistake the working shows; null for a full attempt. */
  misconception: DemoMisconceptionKey | null;
  /** How many hints are revealed before the working is written. */
  hintLevel: 0 | 1 | 2 | 3;
  /** Days from the start of the history, 0 to `days - 1`. */
  day: number;
  /** A second attempt at a question whose first attempt was not full. */
  repeat: boolean;
};

/** A small seeded PRNG (mulberry32): numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SHARE = { full: 0.4, partial: 0.35 }; // the rest are stuck
const REPEAT_SHARE = 0.2;
const HINT_SHARE = 1 / 3;
const HINT_PRIORITY: Record<Outcome, number> = { stuck: 0.6, partial: 0.4, full: 0.2 };

const topicKey = (q: DemoQuestion) => `${q.course}\u0000${q.topics[0] ?? ""}`;

/** Spreads `count` items evenly over the days `from` to `to`, in order. */
const spread = (index: number, count: number, from: number, to: number) =>
  from + Math.floor((index * (to - from + 1)) / count);

/** Alternates the courses, so that each day mixes them. */
function interleave(questions: DemoQuestion[]): DemoQuestion[] {
  const byCourse = new Map<string, DemoQuestion[]>();
  for (const q of questions) byCourse.set(q.course, [...(byCourse.get(q.course) ?? []), q]);
  const lists = [...byCourse.values()];
  const out: DemoQuestion[] = [];
  for (let i = 0; out.length < questions.length; i++)
    for (const list of lists) if (i < list.length) out.push(list[i]);
  return out;
}

/**
 * The attempts the template student makes over `days` days (default 21): every
 * question once (sheet 1 before sheet 2), and about a fifth of them again later.
 * About 40% end full, 35% partial and 25% stuck; hints are revealed on about a third;
 * every attempt that is not full shows one of 3 or 4 recurring misconceptions.
 * Topics have a fixed strength, so some end strong and some weak.
 */
export function planDemoHistory(
  input: DemoQuestion[],
  options: { seed: number; days?: number },
): PlannedAttempt[] {
  const days = options.days ?? 21;
  if (!Number.isInteger(days) || days < 7) throw new RangeError("days must be at least 7");
  if (input.length === 0) return [];
  const rng = mulberry32(options.seed);
  const questions = [...input].sort(
    (a, b) =>
      a.course.localeCompare(b.course) ||
      a.sheet - b.sheet ||
      (a.position ?? 0) - (b.position ?? 0) ||
      a.id.localeCompare(b.id),
  );

  // Each topic of a course gets a strength from 0 (weak) to 1 (strong).
  const bias = new Map<string, number>();
  for (const course of new Set(questions.map((q) => q.course))) {
    const keys = shuffle(
      [...new Set(questions.filter((q) => q.course === course).map(topicKey))],
      rng,
    );
    keys.forEach((key, i) => bias.set(key, keys.length === 1 ? 0.5 : i / (keys.length - 1)));
  }
  const strength = new Map(questions.map((q) => [q.id, bias.get(topicKey(q))! + rng() * 0.6]));

  // Outcome counts over every attempt, repeats included.
  const repeatCount = Math.round(questions.length * REPEAT_SHARE);
  const total = questions.length + repeatCount;
  const recovered = Math.ceil(repeatCount / 2); // repeats that end full
  const weakPartials = Math.ceil((repeatCount - recovered) / 2);
  const fullFirst = Math.max(0, Math.round(total * SHARE.full) - recovered);
  const partialFirst = Math.max(0, Math.round(total * SHARE.partial) - weakPartials);

  const ranked = [...questions].sort((a, b) => strength.get(b.id)! - strength.get(a.id)!);
  const firstOutcome = new Map<string, Outcome>(
    ranked.map((q, i) => [
      q.id,
      i < fullFirst ? "full" : i < fullFirst + partialFirst ? "partial" : "stuck",
    ]),
  );

  // Repeats: the strongest of the questions not done in full recover; the weakest stay weak.
  const notFull = ranked.filter((q) => firstOutcome.get(q.id) !== "full");
  const repeats = Math.min(repeatCount, notFull.length);
  const up = Math.ceil(repeats / 2);
  const repeated: { question: DemoQuestion; outcome: Outcome }[] = [
    ...notFull.slice(0, up).map((question) => ({ question, outcome: "full" as Outcome })),
    ...notFull.slice(notFull.length - (repeats - up)).map((question, i) => ({
      question,
      outcome: (i % 2 === 0 ? "partial" : "stuck") as Outcome,
    })),
  ];

  // Days: sheet 1 in the first part, sheet 2 after it, repeats in the last part.
  const last = days - 1;
  const sheetOneEnd = Math.floor(0.45 * last);
  const sheetTwoEnd = Math.floor(0.82 * last);
  const plan: PlannedAttempt[] = [];
  const firstDay = new Map<string, number>();
  for (const sheet of [1, 2] as const) {
    const [from, to] = sheet === 1 ? [0, sheetOneEnd] : [sheetOneEnd + 1, sheetTwoEnd];
    const order = interleave(questions.filter((q) => q.sheet === sheet));
    order.forEach((q, i) => {
      const day = spread(i, order.length, from, to);
      firstDay.set(q.id, day);
      plan.push(attempt(q, firstOutcome.get(q.id)!, day, false));
    });
  }
  const repeatFrom = Math.floor(0.6 * last);
  repeated
    .sort((a, b) => firstDay.get(a.question.id)! - firstDay.get(b.question.id)!)
    .forEach(({ question, outcome }, i) => {
      const day = Math.max(
        firstDay.get(question.id)! + 2,
        spread(i, repeated.length, repeatFrom, last),
      );
      plan.push(attempt(question, outcome, Math.min(day, last), true));
    });
  // A stable sort keeps the order within a day; the history ends on the last day.
  plan.sort((a, b) => a.day - b.day);
  plan[plan.length - 1].day = last;

  // Misconceptions: each course cycles through them, starting at a different one.
  const notFullCount = plan.filter((a) => a.outcome !== "full").length;
  const kinds = DEMO_MISCONCEPTIONS.slice(0, notFullCount >= 8 ? 4 : 3);
  [...new Set(plan.map((a) => a.course))].forEach((course, c) => {
    plan
      .filter((a) => a.course === course && a.outcome !== "full")
      .forEach((a, j) => (a.misconception = kinds[(j + c) % kinds.length].key));
  });

  // Hints: about a third of the attempts, the stuck ones most often.
  const hinted = plan
    .map((a) => ({ a, priority: HINT_PRIORITY[a.outcome] + rng() * 0.5 }))
    .sort((x, y) => y.priority - x.priority)
    .slice(0, Math.round(plan.length * HINT_SHARE));
  for (const { a } of hinted) {
    const extra = rng() < (a.outcome === "stuck" ? 0.5 : 0.35) ? 1 : 0;
    a.hintLevel = ((a.outcome === "stuck" ? 2 : 1) + extra) as 1 | 2 | 3;
  }
  return plan;
}

function attempt(q: DemoQuestion, outcome: Outcome, day: number, repeat: boolean): PlannedAttempt {
  return {
    questionId: q.id,
    course: q.course,
    sheet: q.sheet,
    outcome,
    misconception: null,
    hintLevel: 0,
    day,
    repeat,
  };
}
