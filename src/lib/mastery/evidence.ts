import type { HintLevel, MarkBasis, Outcome } from "@/lib/domain";

const OUTCOME_VALUE: Record<Outcome, number> = { full: 1, partial: 0.5, stuck: 0 };
const HINT_MULTIPLIER = [1, 0.85, 0.6, 0.35] as const;
const SLOW_FACTOR = 0.9;

export type MarkedAttempt = {
  at: Date;
  outcome: Outcome;
  hintLevel: HintLevel;
  secondsSpent: number | null;
  expectedMinutes: number;
  basis: MarkBasis;
};

/** Evidence in [0, 1] that the student can do this kind of question unaided. */
export function evidenceScore(a: MarkedAttempt): number {
  const tookTooLong = a.secondsSpent !== null && a.secondsSpent > 2 * a.expectedMinutes * 60;
  return OUTCOME_VALUE[a.outcome] * HINT_MULTIPLIER[a.hintLevel] * (tookTooLong ? SLOW_FACTOR : 1);
}
