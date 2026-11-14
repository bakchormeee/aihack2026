import { describe, expect, it } from "vitest";

import {
  levelPercentages,
  rungStates,
  rungsLabel,
  sanitiseCounts,
  totalSolved,
} from "./hint-ladder";

describe("hint ladder helpers", () => {
  it("fills rungs up to the revealed level", () => {
    expect(rungStates(0)).toEqual([false, false, false]);
    expect(rungStates(2)).toEqual([true, true, false]);
    expect(rungStates(3)).toEqual([true, true, true]);
  });

  it("labels the rungs in words", () => {
    expect(rungsLabel(0)).toBe("No hints used");
    expect(rungsLabel(2)).toBe("2 of 3 hints used");
  });

  it("sanitises bad counts", () => {
    expect(sanitiseCounts([-1, 2.7, NaN, 3])).toEqual([0, 2, 0, 3]);
    expect(totalSolved([1, 2, 3, 4])).toBe(10);
  });

  it("returns zeros when nothing is solved", () => {
    expect(levelPercentages([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });

  it("returns percentages that always sum to 100", () => {
    expect(levelPercentages([1, 1, 1, 0])).toEqual([34, 33, 33, 0]);
    expect(levelPercentages([5, 0, 0, 0])).toEqual([100, 0, 0, 0]);
    const p = levelPercentages([7, 3, 2, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
  });
});
