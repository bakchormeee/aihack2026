// The attempt timeline on a question page (SPEC-study-views.md, mark-in-place): one dot per
// submitted attempt, oldest on the left. Pure: names, the "+N earlier" split and the keys.

import type { Outcome } from "@/lib/domain";

/** With more attempts than this, the oldest collapse into "+N earlier". */
export const MAX_VISIBLE_DOTS = 6;

export type TimelineAttempt = {
  id: string;
  date: Date;
  /** The attempt's current mark; null while it has none. */
  score: number | null;
  outcome: Outcome | null;
};

export type TimelineDot = {
  id: string;
  /** 1 for the oldest attempt. */
  number: number;
  /** "24 November". */
  dateLabel: string;
  outcome: Outcome | null;
  selected: boolean;
  /** "Attempt 2, 24 November, 2 out of 5, partial". */
  name: string;
};

/** The calendar day in London, as the rest of the app shows dates. */
export function dayLabel(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
}

/** The dots, oldest first. The selected one is the given id, else the newest. */
export function timelineDots(
  attempts: TimelineAttempt[],
  selectedId: string | null,
): TimelineDot[] {
  const selected = attempts.some((a) => a.id === selectedId) ? selectedId : attempts.at(-1)?.id;
  return attempts.map((attempt, index) => {
    const dateLabel = dayLabel(attempt.date);
    const mark =
      attempt.score === null || attempt.outcome === null
        ? "not marked yet"
        : `${attempt.score} out of 5, ${attempt.outcome}`;
    return {
      id: attempt.id,
      number: index + 1,
      dateLabel,
      outcome: attempt.outcome,
      selected: attempt.id === selected,
      name: `Attempt ${index + 1}, ${dateLabel}, ${mark}`,
    };
  });
}

/**
 * Which dots show. Up to MAX_VISIBLE_DOTS all do; beyond that the oldest are hidden behind
 * "+N earlier" until `expanded`, or when the selected attempt is one of them.
 */
export function visibleDots(
  dots: TimelineDot[],
  expanded: boolean,
): { shown: TimelineDot[]; hiddenCount: number } {
  const overflow = Math.max(0, dots.length - MAX_VISIBLE_DOTS);
  const selectedIsHidden = dots.slice(0, overflow).some((dot) => dot.selected);
  if (expanded || selectedIsHidden || overflow === 0) return { shown: dots, hiddenCount: 0 };
  return { shown: dots.slice(overflow), hiddenCount: overflow };
}

/** The dot to focus after a key press in the timeline; null for a key that does nothing. */
export function focusAfterKey(key: string, index: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(count - 1, index + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
