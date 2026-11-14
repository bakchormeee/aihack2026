import { describe, expect, it } from "vitest";
import type { HintLevel, MarkBasis } from "@/lib/domain";
import {
  attemptHintLevel,
  canDispute,
  currentMark,
  isSolutionUnlocked,
  outcomeFromScore,
} from "./rules";

describe("outcomeFromScore", () => {
  it.each([
    [0, "stuck"],
    [24, "stuck"],
    [25, "partial"],
    [89, "partial"],
    [90, "full"],
    [100, "full"],
  ] as const)("score %i is %s", (score, outcome) => {
    expect(outcomeFromScore(score)).toBe(outcome);
  });

  it("boundary 24 is stuck", () => expect(outcomeFromScore(24)).toBe("stuck"));
  it("boundary 25 is partial", () => expect(outcomeFromScore(25)).toBe("partial"));
  it("boundary 89 is partial", () => expect(outcomeFromScore(89)).toBe("partial"));
  it("boundary 90 is full", () => expect(outcomeFromScore(90)).toBe("full"));
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
