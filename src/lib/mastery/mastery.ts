import { evidenceScore, type MarkedAttempt } from "./evidence";

export type { MarkedAttempt };

const LEARNING_RATE = 0.3;
const START_MASTERY = 0.5;
const PROVISIONAL_WEIGHT = 0.5;
// A spot-the-error answer counts half as much as a provisional long-form mark.
const SPOT_WEIGHT = 0.25;
const WEIGHT_FOR_FULL_CONFIDENCE = 4;
const CONFIDENCE_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Replays the attempts in time order. Nothing is stored: mastery is recomputed
 * from the marks each time, so it can never disagree with them.
 */
export function replayMastery(
  attempts: MarkedAttempt[],
  now: Date,
): {
  mastery: number;
  confidence: number;
  priority: number;
  attempts: number;
  series: { at: Date; mastery: number }[];
} {
  const ordered = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());

  let mastery = START_MASTERY;
  let totalWeight = 0;
  const series: { at: Date; mastery: number }[] = [];

  for (const a of ordered) {
    const weight =
      a.kind === "spot" ? SPOT_WEIGHT : a.basis === "official" ? 1 : PROVISIONAL_WEIGHT;
    mastery += LEARNING_RATE * weight * (evidenceScore(a) - mastery);
    totalWeight += weight;
    series.push({ at: a.at, mastery });
  }

  // No attempts: totalWeight is 0, so confidence is 0 whatever the decay.
  const last = ordered.at(-1);
  // Decision: a clock before the last attempt counts as zero days, not negative decay.
  const days = last ? Math.max(0, (now.getTime() - last.at.getTime()) / MS_PER_DAY) : 0;
  const confidence =
    Math.min(1, totalWeight / WEIGHT_FOR_FULL_CONFIDENCE) *
    0.5 ** (days / CONFIDENCE_HALF_LIFE_DAYS);

  return {
    mastery,
    confidence,
    priority: (1 - mastery) * (2 - confidence),
    attempts: ordered.length,
    series,
  };
}
