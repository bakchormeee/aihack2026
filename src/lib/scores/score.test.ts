import { describe, expect, it } from "vitest";

import {
  coverageText,
  formatAttempted,
  formatScore,
  numberedQuestions,
  questionNumber,
  scoreLine,
  sheetScore,
  type PartMark,
} from "./score";

describe("questionNumber", () => {
  it.each([
    ["1", "1"],
    ["2(a)", "2"],
    ["3(a)(ii)", "3"],
    [" 10 (iii)", "10"],
    ["A", "A"],
    ["  7  ", "7"],
  ])("%j is question %j", (label, expected) => {
    expect(questionNumber(label)).toBe(expected);
  });
});

// The spec's worked example: 1 is 5/5, 2(a) 5/5, 2(b) 3/5, 3 is still marking, 4 is not started.
const example: PartMark[] = [
  { label: "1", mark: 5 },
  { label: "2(a)", mark: 5 },
  { label: "2(b)", mark: 3 },
  { label: "3", mark: null },
  { label: "4", mark: null },
];

describe("numberedQuestions", () => {
  it("averages the marked parts of a question", () => {
    const [, two] = numberedQuestions(example);
    expect(two).toEqual({ number: "2", mark: 4, markedLabels: ["2(a)", "2(b)"], parts: 2 });
  });

  it("does not let an unmarked part lower the mark", () => {
    const [only] = numberedQuestions([
      { label: "2(a)", mark: 5 },
      { label: "2(b)", mark: null },
    ]);
    expect(only).toEqual({ number: "2", mark: 5, markedLabels: ["2(a)"], parts: 2 });
  });

  it("rounds the mean to one decimal and keeps the order of first appearance", () => {
    const list = numberedQuestions([
      { label: "b", mark: 1 },
      { label: "a(i)", mark: 4 },
      { label: "a(ii)", mark: 4 },
      { label: "a(iii)", mark: 3 },
    ]);
    expect(list.map((q) => q.number)).toEqual(["b", "a"]);
    expect(list[1].mark).toBe(3.7);
  });

  it("has no mark for a question with nothing marked", () => {
    expect(numberedQuestions([{ label: "3", mark: null }])).toEqual([
      { number: "3", mark: null, markedLabels: [], parts: 1 },
    ]);
  });
});

describe("sheetScore", () => {
  it("counts only attempted questions: 9 / 10 (90%) and Attempted 2 / 4", () => {
    const score = sheetScore(example);
    expect(score).toEqual({ attempted: 2, total: 4, points: 9, max: 10, percent: 90 });
    expect(formatScore(score)).toBe("9 / 10 (90%)");
    expect(formatAttempted(score)).toBe("Attempted 2 / 4");
  });

  it("makes question 2 worth 5/5 when only 2(a) is marked", () => {
    const score = sheetScore([
      { label: "1", mark: 5 },
      { label: "2(a)", mark: 5 },
      { label: "2(b)", mark: null },
    ]);
    expect(score).toMatchObject({ attempted: 2, total: 2, points: 10, max: 10, percent: 100 });
  });

  it("keeps a decimal point in the points and rounds the percentage", () => {
    const score = sheetScore([
      { label: "1(a)", mark: 4 },
      { label: "1(b)", mark: 3 },
      { label: "2", mark: 2 },
    ]);
    expect(score).toMatchObject({ points: 5.5, max: 10, percent: 55 });
    expect(formatScore(score)).toBe("5.5 / 10 (55%)");
  });

  it("is empty when nothing is marked", () => {
    const score = sheetScore([
      { label: "1", mark: null },
      { label: "2", mark: null },
    ]);
    expect(score).toEqual({ attempted: 0, total: 2, points: 0, max: 0, percent: null });
    expect(formatScore(score)).toBe("–");
    expect(formatAttempted(score)).toBe("Attempted 0 / 2");
  });

  it("handles a sheet with no questions", () => {
    expect(sheetScore([])).toEqual({ attempted: 0, total: 0, points: 0, max: 0, percent: null });
  });
});

describe("coverageText", () => {
  it("names the questions with a mark, and the parts of a partly marked one", () => {
    expect(
      coverageText([
        { label: "1", mark: 5 },
        { label: "2(a)", mark: 4 },
        { label: "2(b)", mark: null },
        { label: "3", mark: null },
        { label: "4", mark: 2 },
      ]),
    ).toBe("Based on questions 1, 2(a) and 4");
  });

  it("names a question by its number once every part is marked", () => {
    expect(
      coverageText([
        { label: "2(a)", mark: 4 },
        { label: "2(b)", mark: 3 },
      ]),
    ).toBe("Based on question 2");
  });

  it("says nothing when nothing is marked", () => {
    expect(coverageText([{ label: "1", mark: null }])).toBe("");
  });

  it("names two marked parts of a question with a third unmarked", () => {
    expect(
      coverageText([
        { label: "2(a)", mark: 4 },
        { label: "2(b)", mark: 3 },
        { label: "2(c)", mark: null },
      ]),
    ).toBe("Based on questions 2(a) and 2(b)");
  });
});

describe("scoreLine", () => {
  it("shows the marks large, then the percentage and the attempted count", () => {
    expect(scoreLine({ attempted: 5, total: 9, points: 17, max: 25, percent: 68 })).toEqual({
      big: "17 / 25",
      detail: "68% · attempted 5 of 9 questions",
    });
  });

  it("says there are no marks yet", () => {
    expect(scoreLine(sheetScore([{ label: "1", mark: null }]))).toEqual({
      big: null,
      detail: "Attempted 0 of 1 questions · no marks yet",
    });
  });
});
