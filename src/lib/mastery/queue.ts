import type { HintLevel, Outcome } from "@/lib/domain";

export type Candidate = {
  questionId: string;
  topicIds: string[];
  expectedMinutes: number;
  lastAttemptAt: Date;
  lastOutcome: Outcome;
  lastHintLevel: HintLevel;
  consecutiveFull: number;
  label: string;
};

type QueueItem = { source: "retry" | "variant"; questionId: string; reason: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETRY_SHARE = 0.6;
// Days to wait after 1, 2, 3, 4+ consecutive full attempts.
const SPACED_INTERVAL_DAYS = [1, 3, 7, 14] as const;

function intervalDays(c: Candidate): number {
  if (c.lastOutcome !== "full") return 1;
  // Decision: consecutiveFull of 0 after a full (not expected) uses the shortest interval.
  const step = Math.min(Math.max(c.consecutiveFull, 1), SPACED_INTERVAL_DAYS.length) - 1;
  return SPACED_INTERVAL_DAYS[step];
}

function isDue(c: Candidate, now: Date): boolean {
  return now.getTime() - c.lastAttemptAt.getTime() >= intervalDays(c) * MS_PER_DAY;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function describeAge(c: Candidate, now: Date): string {
  const days = Math.floor((now.getTime() - c.lastAttemptAt.getTime()) / MS_PER_DAY);
  return days <= 0 ? "today" : `${plural(days, "day")} ago`;
}

function retryReason(c: Candidate, now: Date): string {
  const age = describeAge(c, now);
  const hints = c.lastHintLevel > 0 ? plural(c.lastHintLevel, "hint") : null;
  if (c.lastOutcome === "full") {
    return hints ? `you used ${hints} on this ${age}` : `due for spaced review, last done ${age}`;
  }
  const what = c.lastOutcome === "stuck" ? "you got stuck on this" : "you only got part of this";
  return `${what} ${age}${hints ? `, using ${hints}` : ""}`;
}

/**
 * Ranks the (already filtered) retry candidates and fills the session length.
 * Decisions where the spec is silent:
 * - Candidates without a known topic priority count as priority 0; ties go to the
 *   oldest last attempt, then to the question id, so the order is deterministic.
 * - Retries take candidates in rank order while they fit in 60% of the time; one
 *   that does not fit is skipped, a smaller one behind it may still fit.
 * - Variants get the remaining time (so unused retry time goes to variants), one
 *   variant per parent, preferring parents that were not chosen as a retry.
 * - Retry items come first in the output, then variants.
 */
export function buildQueue(i: {
  candidates: Candidate[];
  priorityByTopic: Record<string, number>;
  targetMinutes: number;
  now: Date;
}): { items: QueueItem[] } {
  const topPriority = (c: Candidate) =>
    Math.max(0, ...c.topicIds.map((t) => i.priorityByTopic[t] ?? 0));

  const ranked = i.candidates
    .map((c) => ({ c, due: isDue(c, i.now), priority: topPriority(c) }))
    .sort(
      (a, b) =>
        Number(b.due) - Number(a.due) ||
        b.priority - a.priority ||
        a.c.lastAttemptAt.getTime() - b.c.lastAttemptAt.getTime() ||
        a.c.questionId.localeCompare(b.c.questionId),
    )
    .map((r) => r.c);

  const retries: Candidate[] = [];
  let retryMinutes = 0;
  for (const c of ranked) {
    if (retryMinutes + c.expectedMinutes <= i.targetMinutes * RETRY_SHARE) {
      retries.push(c);
      retryMinutes += c.expectedMinutes;
    }
  }

  const retried = new Set(retries);
  const variantParents = [...ranked.filter((c) => !retried.has(c)), ...retries];
  const variants: Candidate[] = [];
  let variantMinutes = 0;
  for (const c of variantParents) {
    if (retryMinutes + variantMinutes + c.expectedMinutes <= i.targetMinutes) {
      variants.push(c);
      variantMinutes += c.expectedMinutes;
    }
  }

  return {
    items: [
      ...retries.map((c): QueueItem => ({
        source: "retry",
        questionId: c.questionId,
        reason: retryReason(c, i.now),
      })),
      ...variants.map((c): QueueItem => ({
        source: "variant",
        questionId: c.questionId,
        reason: `a fresh variant of ${c.label}, because ${retryReason(c, i.now)}`,
      })),
    ],
  };
}
