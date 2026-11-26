import { describe, expect, it } from "vitest";

import { ERROR_TYPES, OUTCOMES, SEVERITIES } from "@/lib/domain";

import {
  ERROR_LABEL,
  MARKING_SCHEME,
  OUTCOME_LABEL,
  SEVERITY_LABEL,
  solutionLabel,
} from "./labels";

describe("labels", () => {
  it("has a label for every error type, outcome and severity", () => {
    for (const type of ERROR_TYPES) expect(ERROR_LABEL[type]).toBeTruthy();
    for (const outcome of OUTCOMES) expect(OUTCOME_LABEL[outcome]).toBeTruthy();
    for (const severity of SEVERITIES) expect(SEVERITY_LABEL[severity]).toBeTruthy();
  });

  it("calls a score of 4 or 5 correct in the scheme and in the outcome label", () => {
    expect(OUTCOME_LABEL.full).toBe("Correct");
    expect(MARKING_SCHEME.find((row) => row.score === 4)?.meaning).toMatch(/counts as correct/i);
  });

  it("explains every score from 5 down to 0, once each, in order", () => {
    expect(MARKING_SCHEME.map((row) => row.score)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("says whether a solution is the official one or the AI's", () => {
    expect(solutionLabel("official")).toBe("Official solution");
    expect(solutionLabel("ai")).toBe("AI-written solution");
  });
});
