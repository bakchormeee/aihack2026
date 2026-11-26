import { describe, expect, it } from "vitest";

import {
  BAND_LABEL,
  BAND_LEGEND,
  MIN_ATTEMPTS_FOR_BAND,
  NEEDS_WORK_BELOW,
  SOLID_ABOVE,
  masteryBand,
  masteryLine,
  orderTopics,
} from "./band";

describe("masteryBand", () => {
  it("keeps the cut-offs the spec names", () => {
    expect(NEEDS_WORK_BELOW).toBe(0.45);
    expect(SOLID_ABOVE).toBe(0.7);
    expect(MIN_ATTEMPTS_FOR_BAND).toBe(3);
  });

  it("is Needs work just below 0.45", () => {
    expect(masteryBand(0.4499, 3)).toBe("needs_work");
  });

  it("is Getting there from 0.45 up to and including 0.70", () => {
    expect(masteryBand(0.45, 3)).toBe("getting_there");
    expect(masteryBand(0.7, 3)).toBe("getting_there");
  });

  it("is Solid above 0.70", () => {
    expect(masteryBand(0.7001, 3)).toBe("solid");
    expect(masteryBand(1, 10)).toBe("solid");
  });

  it("is Needs work at the bottom of the scale", () => {
    expect(masteryBand(0, 3)).toBe("needs_work");
  });

  it("is Too early to tell with fewer than 3 marked attempts, whatever the mastery", () => {
    expect(masteryBand(0.9, 2)).toBe("too_early");
    expect(masteryBand(0.1, 2)).toBe("too_early");
    expect(masteryBand(0.5, 1)).toBe("too_early");
    expect(masteryBand(null, 0)).toBe("too_early");
    expect(masteryBand(0.2, 0)).toBe("too_early");
  });

  it("is Too early to tell when there is no mastery value, even with attempts", () => {
    expect(masteryBand(null, 5)).toBe("too_early");
  });

  it("starts labelling at exactly 3 attempts", () => {
    expect(masteryBand(0.9, 3)).toBe("solid");
  });

  it("has one word label per band", () => {
    expect(BAND_LABEL).toEqual({
      too_early: "Too early to tell",
      needs_work: "Needs work",
      getting_there: "Getting there",
      solid: "Solid",
    });
  });

  it("explains the labels in one line built from the same cut-offs", () => {
    expect(BAND_LEGEND).toBe(
      "Needs work: below 45% · Getting there: 45–70% · Solid: above 70% · Too early to tell: fewer than 3 marked attempts",
    );
  });
});

describe("masteryLine", () => {
  it("shows the rounded percentage and the attempts", () => {
    expect(masteryLine(0.32, 6)).toBe("Mastery 32% · 6 attempts");
    expect(masteryLine(0.3249, 6)).toBe("Mastery 32% · 6 attempts");
    expect(masteryLine(0.325, 6)).toBe("Mastery 33% · 6 attempts");
  });

  it("says attempt for one", () => {
    expect(masteryLine(0.5, 1)).toBe("Mastery 50% · 1 attempt");
  });

  it("says there are no marked attempts when there is no mastery", () => {
    expect(masteryLine(null, 0)).toBe("No marked attempts yet");
  });
});

describe("orderTopics", () => {
  const topic = (name: string, mastery: number | null) => ({ name, mastery });

  it("puts the weakest first, then unmarked topics by name", () => {
    const ordered = orderTopics([
      topic("Zeta", null),
      topic("Strong", 0.9),
      topic("Alpha", null),
      topic("Weak", 0.2),
      topic("Middle", 0.5),
    ]);

    expect(ordered.map((t) => t.name)).toEqual(["Weak", "Middle", "Strong", "Alpha", "Zeta"]);
  });

  it("breaks ties in mastery by name", () => {
    const ordered = orderTopics([topic("b", 0.4), topic("a", 0.4), topic("c", 0.1)]);

    expect(ordered.map((t) => t.name)).toEqual(["c", "a", "b"]);
  });

  it("does not change the list it is given", () => {
    const input = [topic("b", 0.9), topic("a", 0.1)];

    orderTopics(input);

    expect(input.map((t) => t.name)).toEqual(["b", "a"]);
  });

  it("handles an empty list", () => {
    expect(orderTopics([])).toEqual([]);
  });
});
