import type { ErrorType, HintLevel, MarkBasis, Outcome, Severity } from "@/lib/domain";

/** Marks are out of 5 (SPEC-marking-v2.md). */
export const MAX_SCORE = 5;
// 4-5 correct, 2-3 partly right, 0-1 stuck. A 4 is the right structure with 1-2 careless slips.
const FULL_MIN_SCORE = 4;
const PARTIAL_MIN_SCORE = 2;
const MAX_DISPUTES = 2;

export function outcomeFromScore(score: number): Outcome {
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
    throw new RangeError(`A score must be a whole number from 0 to ${MAX_SCORE}`);
  }
  if (score >= FULL_MIN_SCORE) return "full";
  if (score >= PARTIAL_MIN_SCORE) return "partial";
  return "stuck";
}

const CARELESS_TYPES: readonly ErrorType[] = ["algebra_slip", "arithmetic_slip", "notation"];

/** Careless slips are marked down less than structural errors. */
export function severityOf(type: ErrorType): Severity {
  return CARELESS_TYPES.includes(type) ? "careless" : "structural";
}

/** Converts a mark from the old 0-100 scale (used once, by the data migration). */
export function scoreFromOldScale(old: number): number {
  if (old >= 90) return 5;
  if (old >= 70) return 4;
  if (old >= 50) return 3;
  if (old >= 25) return 2;
  if (old >= 10) return 1;
  return 0;
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
