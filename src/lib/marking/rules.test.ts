import { describe, expect, it } from "vitest";
import type { HintLevel, MarkBasis } from "@/lib/domain";
import {
  attemptHintLevel,
  canDispute,
  currentMark,
  isSolutionUnlocked,
  MAX_SCORE,
  outcomeFromScore,
  scoreFromOldScale,
  severityOf,
} from "./rules";

describe("outcomeFromScore (marks out of 5)", () => {
  it.each([
    [0, "stuck"],
    [1, "stuck"],
    [2, "partial"],
    [3, "partial"],
    [4, "full"],
    [5, "full"],
  ] as const)("a score of %i is %s", (score, outcome) => {
    expect(outcomeFromScore(score)).toBe(outcome);
  });

  it("a 4 (right structure, 1-2 careless slips) counts as correct", () => {
    expect(outcomeFromScore(4)).toBe("full");
  });

  it("rejects a score outside 0 to 5 or not a whole number", () => {
    expect(() => outcomeFromScore(6)).toThrow(RangeError);
    expect(() => outcomeFromScore(-1)).toThrow(RangeError);
    expect(() => outcomeFromScore(2.5)).toThrow(RangeError);
  });

  it("the maximum score is 5", () => expect(MAX_SCORE).toBe(5));
});

describe("severityOf", () => {
  it.each(["algebra_slip", "arithmetic_slip", "notation"] as const)("%s is careless", (type) => {
    expect(severityOf(type)).toBe("careless");
  });

  it.each(["conceptual", "method", "incomplete", "misread_question"] as const)(
    "%s is structural",
    (type) => {
      expect(severityOf(type)).toBe("structural");
    },
  );
});

describe("scoreFromOldScale", () => {
  it.each([
    [100, 5],
    [90, 5],
    [89, 4],
    [70, 4],
    [69, 3],
    [50, 3],
    [49, 2],
    [25, 2],
    [24, 1],
    [10, 1],
    [9, 0],
    [0, 0],
  ])("an old mark of %i becomes %i", (old, score) => {
    expect(scoreFromOldScale(old)).toBe(score);
  });
});

describe("currentMark", () => {
  const mark = (basis: MarkBasis, day: number) => ({ basis, createdAt: new Date(2026, 10, day) });

  it("is null with no marks", () => expect(currentMark([])).toBeNull());

  it("is the latest ai mark when there is no official mark", () => {
    const marks = [mark("ai", 1), mark("ai", 3), mark("ai", 2)];
    expect(currentMark(marks)).toBe(marks[1]);
  });

  it("prefers an official mark even when an ai mark is newer", () => {
    const marks = [mark("official", 2), mark("ai", 5)];
    expect(currentMark(marks)).toBe(marks[0]);
  });

  it("is the latest of several official marks", () => {
    const marks = [mark("official", 4), mark("official", 2), mark("ai", 9)];
    expect(currentMark(marks)).toBe(marks[0]);
  });

  it("does not mutate its input", () => {
    const marks = [mark("ai", 3), mark("ai", 1)];
    currentMark(marks);
    expect(marks[0].createdAt.getDate()).toBe(3);
  });
});

describe("attemptHintLevel", () => {
  it("is the inherited level when nothing was revealed", () => {
    expect(attemptHintLevel(2, [])).toBe(2);
  });
  it("is the highest revealed level", () => {
    expect(attemptHintLevel(0, [1, 2])).toBe(2);
  });
  it("keeps the inherited level when it is higher", () => {
    expect(attemptHintLevel(3, [1])).toBe(3);
  });
  it("is 0 with nothing inherited or revealed", () => {
    expect(attemptHintLevel(0, [])).toBe(0);
  });
  it("never exceeds 3", () => {
    expect(attemptHintLevel(0, [7])).toBe(3);
  });
});

describe("isSolutionUnlocked", () => {
  const base = {
    hasFullAttempt: false,
    maxHintLevelRevealed: 0 as HintLevel,
    reviewMode: false,
    hasSubmittedAttempt: false,
    hasOfficialSolution: false,
  };

  it("is locked by default", () => expect(isSolutionUnlocked(base)).toBe(false));
  it("unlocks after a full attempt", () =>
    expect(isSolutionUnlocked({ ...base, hasFullAttempt: true })).toBe(true));
  it("unlocks after all three hints", () =>
    expect(isSolutionUnlocked({ ...base, maxHintLevelRevealed: 3 })).toBe(true));
  it("stays locked after two hints", () =>
    expect(isSolutionUnlocked({ ...base, maxHintLevelRevealed: 2 })).toBe(false));
  it("unlocks in review mode with a submitted attempt and an official solution", () =>
    expect(
      isSolutionUnlocked({
        ...base,
        reviewMode: true,
        hasSubmittedAttempt: true,
        hasOfficialSolution: true,
      }),
    ).toBe(true));
  it("stays locked in review mode with no submitted attempt", () =>
    expect(isSolutionUnlocked({ ...base, reviewMode: true, hasOfficialSolution: true })).toBe(
      false,
    ));
  it("stays locked in review mode with no official solution", () =>
    expect(isSolutionUnlocked({ ...base, reviewMode: true, hasSubmittedAttempt: true })).toBe(
      false,
    ));
  it("a submitted attempt and official solution do not unlock outside review mode", () =>
    expect(
      isSolutionUnlocked({ ...base, hasSubmittedAttempt: true, hasOfficialSolution: true }),
    ).toBe(false));
});

describe("canDispute", () => {
  it.each([
    [0, true],
    [1, true],
    [2, false],
    [3, false],
  ])("after %i disputes: %s", (n, expected) => expect(canDispute(n)).toBe(expected));
});
