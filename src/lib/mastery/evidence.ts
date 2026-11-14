import type { HintLevel, MarkBasis, Outcome } from "@/lib/domain";

const OUTCOME_VALUE: Record<Outcome, number> = { full: 1, partial: 0.5, stuck: 0 };
const HINT_MULTIPLIER = [1, 0.85, 0.6, 0.35] as const;
const SLOW_FACTOR = 0.9;
// A correct answer that still had careless slips (4 out of 5) counts a little less than a perfect one.
const CARELESS_CORRECT_VALUE = 0.9;

export type MarkedAttempt = {
  at: Date;
  outcome: Outcome;
  /** Mark out of 5. */
  score: number;
  hintLevel: HintLevel;
  secondsSpent: number | null;
  expectedMinutes: number;
  basis: MarkBasis;
};

/** Evidence in [0, 1] that the student can do this kind of question unaided. */
export function evidenceScore(a: MarkedAttempt): number {
  const tookTooLong = a.secondsSpent !== null && a.secondsSpent > 2 * a.expectedMinutes * 60;
  const value =
    a.outcome === "full" && a.score < 5 ? CARELESS_CORRECT_VALUE : OUTCOME_VALUE[a.outcome];
  return value * HINT_MULTIPLIER[a.hintLevel] * (tookTooLong ? SLOW_FACTOR : 1);
}
