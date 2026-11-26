// The status of one question row on a sheet's Questions tab (SPEC-study-views.md, question-marks).
// Pure: the caller works out the latest submitted attempt and its current mark.

import type { MarkStatus, Outcome } from "@/lib/domain";

/** Marks are out of 5 (same value as MAX_SCORE in src/lib/marking/rules.ts). */
const FULL_MARKS = 5;

export type StatusInput = {
  /** Submitted attempts on the question. */
  submittedAttempts: number;
  /** The latest submitted attempt; null when none is submitted. */
  latest: {
    markStatus: MarkStatus;
    /** Its current mark (official beats AI); null when unmarked. */
    mark: { score: number; outcome: Outcome } | null;
  } | null;
  /** An attempt has working written or attached but not submitted. */
  hasDraft: boolean;
};

export type QuestionStatus =
  | { kind: "none" }
  | { kind: "draft" }
  | { kind: "marking" }
  | { kind: "waiting" }
  | { kind: "failed" }
  | {
      kind: "marked";
      score: number;
      outcome: Outcome;
      /** "Full marks", "Correct, slips", "Partial" or "Stuck". */
      outcomeLabel: string;
      attempts: number;
    };

export function outcomeLabel(outcome: Outcome, score: number): string {
  if (outcome === "full") return score >= FULL_MARKS ? "Full marks" : "Correct, slips";
  return outcome === "partial" ? "Partial" : "Stuck";
}

/**
 * One status per question. The mark is the current mark of the question's latest submitted
 * attempt, not the best one. A draft shows only while nothing is submitted yet.
 */
export function questionStatus(input: StatusInput): QuestionStatus {
  const { latest } = input;
  if (latest === null) return input.hasDraft ? { kind: "draft" } : { kind: "none" };
  if (latest.mark) {
    return {
      kind: "marked",
      score: latest.mark.score,
      outcome: latest.mark.outcome,
      outcomeLabel: outcomeLabel(latest.mark.outcome, latest.mark.score),
      attempts: input.submittedAttempts,
    };
  }
  if (latest.markStatus === "awaiting_official") return { kind: "waiting" };
  if (latest.markStatus === "failed") return { kind: "failed" };
  return { kind: "marking" };
}
