import type { HintLevel } from "@/lib/domain";

export type HintCounts = [number, number, number, number];

export const HINT_LEVEL_LABELS = ["No hint", "Hint 1", "Hint 2", "Hint 3"] as const;

/**
 * Ordinal blue-ink ramp (light to dark = more help used). Validated with the
 * dataviz checker in --ordinal mode against the paper surface: monotone
 * lightness, visible steps, light end at 2.09:1.
 */
export const HINT_LEVEL_FILLS = ["#86b6ef", "#3987e5", "#256abf", "#104281"] as const;

/** Ink for a number or label drawn on each hint fill. */
export const HINT_LEVEL_INK = ["#0b0b0b", "#ffffff", "#ffffff", "#ffffff"] as const;

/** Keeps only finite, non-negative whole counts. */
export function sanitiseCounts(counts: HintCounts): HintCounts {
  return counts.map((n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)) as HintCounts;
}

export function totalSolved(counts: HintCounts): number {
  return sanitiseCounts(counts).reduce((a, b) => a + b, 0);
}

/** Share of questions solved at each level, as whole-number percentages summing to 100 (or all 0). */
export function levelPercentages(counts: HintCounts): HintCounts {
  const clean = sanitiseCounts(counts);
  const total = clean.reduce((a, b) => a + b, 0);
  if (total === 0) return [0, 0, 0, 0];
  const raw = clean.map((n) => (n / total) * 100);
  const floors = raw.map(Math.floor);
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors as HintCounts;
}

/** Rung states for the question screen: rung n (1–3) is filled when revealed >= n. */
export function rungStates(revealed: HintLevel): [boolean, boolean, boolean] {
  return [revealed >= 1, revealed >= 2, revealed >= 3];
}

export function rungsLabel(revealed: HintLevel): string {
  return revealed === 0 ? "No hints used" : `${revealed} of 3 hints used`;
}
