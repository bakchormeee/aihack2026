import type { HintLevel, Outcome } from "@/lib/domain";

export type Candidate = {
  questionId: string;
  topicIds: string[];
  expectedMinutes: number;
  lastAttemptAt: Date;
  lastOutcome: Outcome;
  lastHintLevel: HintLevel;
  label: string;
};

/** A topic with its spaced-review due day (SPEC-spaced-review.md): due when daysUntilDue ≤ 0. */
export type DueTopic = { id: string; name: string; daysUntilDue: number };

type QueueItem = { source: "retry" | "variant"; questionId: string; reason: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RETRY_SHARE = 0.6;

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
    return hints ? `you used ${hints} on this ${age}` : `you last did this ${age}`;
  }
  const what = c.lastOutcome === "stuck" ? "you got stuck on this" : "you only got part of this";
  return `${what} ${age}${hints ? `, using ${hints}` : ""}`;
}

/**
 * Ranks the (already filtered) retry candidates and fills the session length.
 * A candidate with a topic whose spaced review is due ranks first (SPEC-spaced-review.md).
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
  dueTopics: DueTopic[];
  targetMinutes: number;
  now: Date;
}): { items: QueueItem[] } {
  const topPriority = (c: Candidate) =>
    Math.max(0, ...c.topicIds.map((t) => i.priorityByTopic[t] ?? 0));
  const due = new Map(i.dueTopics.filter((t) => t.daysUntilDue <= 0).map((t) => [t.id, t]));
  // The most overdue of the candidate's due topics, or undefined when none is due.
  const dueTopicOf = (c: Candidate) =>
    c.topicIds
      .map((id) => due.get(id))
      .filter((t) => t !== undefined)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue)[0];
  const reasonFor = (c: Candidate) => {
    const topic = dueTopicOf(c);
    const reason = retryReason(c, i.now);
    return topic ? `${topic.name} is due for review, and ${reason}` : reason;
  };

  const ranked = i.candidates
    .map((c) => ({ c, due: dueTopicOf(c) !== undefined, priority: topPriority(c) }))
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
        reason: reasonFor(c),
      })),
      ...variants.map((c): QueueItem => ({
        source: "variant",
        questionId: c.questionId,
        reason: `a fresh variant of ${c.label}, because ${reasonFor(c)}`,
      })),
    ],
  };
}
