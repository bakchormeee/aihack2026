// How a new submission is marked (SPEC-study-views.md, mark-on-official). Pure; the server
// works out `hasOfficial` from the database and never trusts the form for it.

/** Marked now against the official solution, marked now by the AI, or left waiting. */
export type MarkingPlan = "official" | "ai" | "wait";

/**
 * A question with an official solution is always marked against it at once, whatever the
 * switch says. Otherwise the "Mark with AI now" switch decides: on marks against the
 * AI-written solution, off waits for the official solutions.
 */
export function markingPlan(i: { hasOfficial: boolean; markWithAi: boolean }): MarkingPlan {
  if (i.hasOfficial) return "official";
  return i.markWithAi ? "ai" : "wait";
}

/** The switch position sent by a form field: true, false, or undefined when it was not sent. */
export function parseSwitch(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === "on") return true;
  if (value === false || value === "false" || value === "off") return false;
  return undefined;
}

export type SwitchView = {
  /** True when every question is marked against its official solution: the switch cannot change. */
  locked: boolean;
  /** The line under the switch. */
  text: string;
  /** "Applies to N of M questions", when only some of several questions have official solutions. */
  scope: string | null;
};

/**
 * What the "Mark with AI now" switch says. `total` is the number of questions the submit covers
 * and `official` how many of them already have an official solution.
 */
export function switchView(i: { checked: boolean; total: number; official: number }): SwitchView {
  if (i.total > 0 && i.official >= i.total) {
    return { locked: true, text: "Marked against the official solution", scope: null };
  }
  const text = i.checked
    ? "The AI marks it in about a minute."
    : "Not marked until the official solutions are uploaded.";
  const scope =
    i.official > 0 && i.total > 1
      ? `Applies to ${i.total - i.official} of ${i.total} questions`
      : null;
  return { locked: false, text, scope };
}
