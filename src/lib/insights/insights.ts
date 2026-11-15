// Pure helpers behind the "Focus next" panel. No database access here, so
// every rule is unit-tested.

import { dayToDate, isReviewDue, type Schedule } from "@/lib/spaced/review";

const DAY = 24 * 60 * 60 * 1000;

export type TopicForFocus = {
  id: string;
  name: string;
  mastery: number | null;
  confidence: number;
  priority: number;
  attempts: number;
  series: { at: Date; mastery: number }[];
  /** The spaced-review schedule (SPEC-spaced-review.md); null when untried. */
  review: Schedule | null;
};

export type FocusItem = {
  id: string;
  name: string;
  mastery: number | null;
  attempts: number;
  daysSince: number | null;
  /** One short sentence on why this topic was picked. */
  reason: string;
  /** When the review is due; null for an untried topic, whose mastery bar says "Not tried yet". */
  due: { text: string; isDue: boolean } | null;
};

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const shortDate = (day: number) => SHORT_DATE.format(dayToDate(day));
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function dueText(review: Schedule): { text: string; isDue: boolean } {
  const n = review.daysUntilDue;
  if (n === 0) return { text: "Due today", isDue: true };
  if (n < 0) return { text: `Overdue by ${days(-n)}`, isDue: true };
  return { text: `Next review in ${days(n)} (${shortDate(review.dueDay)})`, isDue: false };
}

const isDueTopic = (t: TopicForFocus) =>
  t.attempts > 0 && t.mastery !== null && t.review !== null && isReviewDue(t.review);

/**
 * The line under the panel title: how many topics of the course are due, or when the
 * next review is. Null when no topic has been reviewed yet.
 */
export function reviewSummary(topics: TopicForFocus[]): string | null {
  const reviewed = topics.filter((t) => t.review !== null);
  if (reviewed.length === 0) return null;
  const dueCount = reviewed.filter(isDueTopic).length;
  if (dueCount > 0) return `${dueCount} ${dueCount === 1 ? "topic" : "topics"} due for review.`;
  const next = Math.min(...reviewed.map((t) => t.review!.dueDay));
  return `Nothing due. Next review on ${shortDate(next)}.`;
}

function daysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The topics most worth practising next. First the topics whose spaced review is due,
 * most overdue first, then weakest. Then the highest revision priority among the other
 * topics with marked work (weak, uncertain or going stale), then topics never tried.
 * Topics already secure (mastery ≥ 0.8 with good confidence) are left out unless due.
 */
export function focusTopics(topics: TopicForFocus[], now: Date, limit = 3): FocusItem[] {
  const due = topics
    .filter(isDueTopic)
    .sort((a, b) => a.review!.daysUntilDue - b.review!.daysUntilDue || a.mastery! - b.mastery!);
  const tried = topics
    .filter((t) => t.attempts > 0 && t.mastery !== null && !isDueTopic(t))
    .filter((t) => !(t.mastery! >= 0.8 && t.confidence >= 0.6))
    .sort((a, b) => b.priority - a.priority || a.mastery! - b.mastery!);
  const untried = topics
    .filter((t) => t.attempts === 0 || t.mastery === null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...due, ...tried, ...untried].slice(0, limit).map((t) => {
    const last = t.series.length ? t.series[t.series.length - 1].at : null;
    const daysSince = last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY)) : null;
    let reason: string;
    if (t.mastery === null || t.attempts === 0) {
      reason = "Not tried yet, so there is no evidence either way.";
    } else {
      const pct = Math.round(t.mastery * 100);
      const parts = [
        `${pct}% mastery from ${t.attempts} ${t.attempts === 1 ? "attempt" : "attempts"}`,
      ];
      if (daysSince !== null && daysSince >= 7) parts.push(`last practised ${daysAgo(daysSince)}`);
      else if (t.confidence < 0.4) parts.push("not much evidence yet");
      reason = parts.join(", ") + ".";
    }
    return {
      id: t.id,
      name: t.name,
      mastery: t.mastery,
      attempts: t.attempts,
      daysSince,
      reason,
      due: t.review && t.attempts > 0 && t.mastery !== null ? dueText(t.review) : null,
    };
  });
}
