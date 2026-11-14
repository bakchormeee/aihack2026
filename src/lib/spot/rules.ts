// Pure rules for spot-the-error revision (SPEC-spot-the-error.md): which
// misconceptions to plant, how many errors each question has, and how an answer
// is judged. No I/O, so these are tested to 100%.

import type { Outcome } from "@/lib/domain";

export type MisconceptionInfo = {
  id: string;
  /** Distinct attempts whose current mark has a mistake behind this misconception. */
  timesSeen: number;
  lastSeen: Date;
  topicIds: string[];
  hidden: boolean;
};

/**
 * The misconceptions to plant, best first: seen twice or more (most often seen first,
 * then most recent), then seen once (most recent first). Hidden ones are left out, and
 * with topics chosen only the ones seen in those topics are kept.
 */
export function rankMisconceptions(
  list: MisconceptionInfo[],
  topicIds: string[] | null,
): MisconceptionInfo[] {
  const wanted = topicIds && topicIds.length > 0 ? new Set(topicIds) : null;
  const usable = list.filter(
    (m) => !m.hidden && m.timesSeen >= 1 && (!wanted || m.topicIds.some((id) => wanted.has(id))),
  );
  const recent = (a: MisconceptionInfo, b: MisconceptionInfo) =>
    b.lastSeen.getTime() - a.lastSeen.getTime();
  const common = usable
    .filter((m) => m.timesSeen >= 2)
    .sort((a, b) => b.timesSeen - a.timesSeen || recent(a, b));
  const once = usable.filter((m) => m.timesSeen === 1).sort(recent);
  return [...common, ...once];
}

export type DealtQuestion = {
  /** The misconceptions planted in this question: none, one or two different ones. */
  plant: string[];
  /** The misconception whose topic the question is about (the first planted one). */
  focus: string;
};

/**
 * Deals `count` questions across the ranked misconceptions in turn. About 1 in 5 has no
 * planted error and 1 in 5 has two (different ones); the rest have one. `random` is
 * injected so the order is testable.
 */
export function dealQuestions(
  count: number,
  ranked: string[],
  random: () => number = Math.random,
): DealtQuestion[] {
  if (count <= 0 || ranked.length === 0) return [];

  const none = Math.round(count / 5);
  const two = ranked.length >= 2 ? Math.round(count / 5) : 0;
  const sizes = [
    ...Array<number>(none).fill(0),
    ...Array<number>(two).fill(2),
    ...Array<number>(count - none - two).fill(1),
  ];
  for (let i = sizes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
  }

  let cursor = 0;
  const next = () => ranked[cursor++ % ranked.length];
  return sizes.map((size) => {
    if (size === 0) return { plant: [], focus: next() };
    const plant = Array.from({ length: size }, next);
    return { plant, focus: plant[0] };
  });
}

/** Sorts the lines the student ticked against the lines that really have a planted error. */
export function judgeLines(planted: number[], ticked: number[]) {
  return {
    found: ticked.filter((line) => planted.includes(line)),
    missed: planted.filter((line) => !ticked.includes(line)),
    wrong: ticked.filter((line) => !planted.includes(line)),
  };
}

/**
 * The outcome of one spot-the-error answer. `explained[line]` says whether the AI judged
 * the student's explanation of that planted line right.
 *  - correct: exactly the planted lines ticked (or "No error" on a clean question), all explained right;
 *  - partly right: at least one planted line found and explained right, but not correct;
 *  - stuck: anything else.
 */
export function spotOutcome(a: {
  planted: number[];
  ticked: number[];
  noError: boolean;
  explained: Record<number, boolean>;
}): Outcome {
  if (a.planted.length === 0) return a.noError && a.ticked.length === 0 ? "full" : "stuck";
  if (a.noError) return "stuck";

  const { found, missed, wrong } = judgeLines(a.planted, a.ticked);
  const right = found.filter((line) => a.explained[line] === true);
  if (missed.length === 0 && wrong.length === 0 && right.length === found.length) return "full";
  return right.length > 0 ? "partial" : "stuck";
}

/** Distinct attempts whose current mark is the mark a mistake behind the misconception came from. */
export function timesSeen(
  sources: { attemptId: string; markId: string }[],
  currentMarkByAttempt: Map<string, string>,
): number {
  const attempts = new Set<string>();
  for (const source of sources)
    if (currentMarkByAttempt.get(source.attemptId) === source.markId)
      attempts.add(source.attemptId);
  return attempts.size;
}

export const MAX_EXPLANATION = 500;

/** Why an answer cannot be submitted, or null when it can. */
export function checkAnswer(
  lineCount: number,
  a: { noError: boolean; ticked: { line: number; explanation: string }[] },
): string | null {
  if (a.noError && a.ticked.length > 0)
    return "Choose either No error or the lines you think are wrong, not both.";
  if (!a.noError && a.ticked.length === 0)
    return "Tick the lines you think are wrong, or press No error.";
  const seen = new Set<number>();
  for (const { line, explanation } of a.ticked) {
    if (!Number.isInteger(line) || line < 1 || line > lineCount) return "That line does not exist.";
    if (seen.has(line)) return "Each line can be ticked once.";
    seen.add(line);
    const length = explanation.trim().length;
    if (length === 0) return `Explain what is wrong in line ${line}.`;
    if (length > MAX_EXPLANATION)
      return `Keep the explanation of line ${line} to ${MAX_EXPLANATION} characters.`;
  }
  return null;
}
