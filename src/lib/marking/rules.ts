import type { HintLevel, MarkBasis, Outcome } from "@/lib/domain";

const FULL_MIN_SCORE = 90;
const PARTIAL_MIN_SCORE = 25;
const MAX_DISPUTES = 2;

export function outcomeFromScore(score: number): Outcome {
  if (score >= FULL_MIN_SCORE) return "full";
  if (score >= PARTIAL_MIN_SCORE) return "partial";
  return "stuck";
}

/** Latest official mark if any, otherwise the latest ai mark; null when unmarked. */
export function currentMark<M extends { basis: MarkBasis; createdAt: Date }>(marks: M[]): M | null {
  const latest = (basis: MarkBasis) =>
    marks
      .filter((m) => m.basis === basis)
      .reduce<M | null>(
        (best, m) => (best === null || m.createdAt > best.createdAt ? m : best),
        null,
      );
  return latest("official") ?? latest("ai");
}

/** Highest hint level visible during the attempt: inherited or revealed, capped at 3. */
export function attemptHintLevel(inherited: HintLevel, revealedLevels: number[]): HintLevel {
  return Math.min(3, Math.max(inherited, ...revealedLevels)) as HintLevel;
}

// Decision: review mode unlocks only when an official solution exists, because
// the review page exists to show it; outside review mode only a full attempt or
// all three hints unlock.
export function isSolutionUnlocked(i: {
  hasFullAttempt: boolean;
  maxHintLevelRevealed: HintLevel;
  reviewMode: boolean;
  hasSubmittedAttempt: boolean;
  hasOfficialSolution: boolean;
}): boolean {
  if (i.hasFullAttempt || i.maxHintLevelRevealed === 3) return true;
  return i.reviewMode && i.hasSubmittedAttempt && i.hasOfficialSolution;
}

export function canDispute(disputeCount: number): boolean {
  return disputeCount < MAX_DISPUTES;
}
