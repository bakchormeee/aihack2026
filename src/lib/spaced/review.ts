// Spaced review of topics, Anki style (SPEC-spaced-review.md). Pure rules: each marked
// answer on a topic is a review with a grade; at most one review counts per UK day; the
// SM-2 rule turns the reviews into an interval and a due day. Nothing is stored: the
// schedule is replayed from the marks each time, like mastery.

import { isSlow, type MarkedAttempt } from "@/lib/mastery/evidence";

export type Grade = "again" | "hard" | "good" | "easy";

const WORST_FIRST: Grade[] = ["again", "hard", "good", "easy"];

const START_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;
const HARD_FACTOR = 1.2;
const EASY_BONUS = 1.3;
const FIRST_INTERVAL: Record<Grade, number> = { again: 1, hard: 1, good: 3, easy: 4 };
const EASE_CHANGE: Record<Grade, number> = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 };

const DAY_MS = 24 * 60 * 60 * 1000;
const LONDON = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The grade of one marked answer, from its outcome (spec section 2). */
export function gradeOf(a: MarkedAttempt): Grade {
  if (a.outcome === "stuck") return "again";
  if (a.outcome === "partial") return "hard";
  // Full from here on.
  if (a.kind === "spot") return "good";
  if (a.hintLevel >= 2) return "hard";
  if (a.hintLevel === 1 || isSlow(a)) return "good";
  return "easy";
}

/** The calendar day in UK time, as a whole number of days since 1 January 1970. */
export function londonDay(date: Date): number {
  const [y, m, d] = LONDON.format(date).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** A day from londonDay as a date at midnight UTC of that calendar day (format it in UTC). */
export function dayToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

export type Review = { at: Date; grade: Grade };

/** One review per day: the worst grade of the day, at the time of the day's last review. */
export function collapseByDay(reviews: Review[]): (Review & { day: number })[] {
  const byDay = new Map<number, Review & { day: number }>();
  for (const r of [...reviews].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const day = londonDay(r.at);
    const kept = byDay.get(day);
    const grade =
      kept && WORST_FIRST.indexOf(kept.grade) < WORST_FIRST.indexOf(r.grade) ? kept.grade : r.grade;
    byDay.set(day, { day, at: r.at, grade });
  }
  return [...byDay.values()];
}

export type Schedule = {
  /** Days from the last review to the next. */
  interval: number;
  ease: number;
  /** Number of days that counted as a review. */
  reviews: number;
  lastDay: number;
  dueDay: number;
  /** Days from today to the due day: 0 today, negative when overdue. */
  daysUntilDue: number;
};

/** Replays a topic's reviews through SM-2 (spec section 3). Null when it has none. */
export function replaySchedule(reviews: Review[], now: Date): Schedule | null {
  const days = collapseByDay(reviews);
  if (days.length === 0) return null;

  let interval = 0;
  let ease = START_EASE;
  days.forEach(({ grade }, i) => {
    if (i === 0) interval = FIRST_INTERVAL[grade];
    else if (grade === "again") interval = 1;
    else {
      const factor = grade === "hard" ? HARD_FACTOR : grade === "good" ? ease : ease * EASY_BONUS;
      interval = Math.min(MAX_INTERVAL, Math.max(interval + 1, Math.round(interval * factor)));
    }
    // Rounded to two places so that repeated steps do not drift.
    ease = Math.max(MIN_EASE, Math.round((ease + EASE_CHANGE[grade]) * 100) / 100);
  });

  const lastDay = days[days.length - 1].day;
  const dueDay = lastDay + interval;
  return {
    interval,
    ease,
    reviews: days.length,
    lastDay,
    dueDay,
    daysUntilDue: dueDay - londonDay(now),
  };
}

/** True on and after the due day. */
export function isReviewDue(s: Schedule): boolean {
  return s.daysUntilDue <= 0;
}
