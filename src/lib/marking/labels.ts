// Words shown to students for marks. One list, so every screen agrees.

import type { ErrorType, Outcome, Severity } from "@/lib/domain";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  full: "Correct",
  partial: "Partly right",
  stuck: "Stuck",
};

export const ERROR_LABEL: Record<ErrorType, string> = {
  conceptual: "Concept",
  method: "Method",
  incomplete: "Incomplete",
  misread_question: "Misread the question",
  algebra_slip: "Algebra or sign slip",
  arithmetic_slip: "Arithmetic or copying slip",
  notation: "Notation or typo",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  careless: "Careless slip",
  structural: "Structural mistake",
};

/** What each mark out of 5 means (SPEC-marking-v2.md). */
export const MARKING_SCHEME: { score: number; meaning: string }[] = [
  { score: 5, meaning: "Fully correct." },
  { score: 4, meaning: "Right structure, with 1–2 careless slips. Counts as correct." },
  { score: 3, meaning: "Right approach, but a structural gap, or 3 or more careless slips." },
  { score: 2, meaning: "A sound start, then a structural error." },
  { score: 1, meaning: "Only a relevant idea." },
  { score: 0, meaning: "Blank, off-topic or for a different question." },
];
