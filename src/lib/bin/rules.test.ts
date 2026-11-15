import { describe, expect, it } from "vitest";

import { BIN_DAYS, binnedQuestionIds, deleteSentence, eraseDate, isDueForErasing } from "./rules";

const DAY = 24 * 60 * 60 * 1000;
const T = new Date("2026-11-15T12:00:00Z");

describe("binnedQuestionIds", () => {
  const q = (id: string, sheetId: string | null, parentQuestionId: string | null = null) => ({
    id,
    sheetId,
    parentQuestionId,
  });

  it("takes the questions of a binned sheet and every variant descended from them", () => {
    const questions = [
      q("a", "s1"),
      q("b", "s2"),
      q("v1", null, "a"), // variant of a
      q("v2", null, "v1"), // variant of a variant
      q("v3", null, "b"),
      q("orphan", null, null), // a variant whose parent was removed
    ];
    expect([...binnedQuestionIds(questions, new Set(["s1"]))].sort()).toEqual(["a", "v1", "v2"]);
  });

  it("takes nothing when no sheet is binned, and survives a loop of parents", () => {
    const questions = [q("x", null, "y"), q("y", null, "x"), q("a", "s1")];
    expect(binnedQuestionIds(questions, new Set())).toEqual(new Set());
    expect(binnedQuestionIds(questions, new Set(["s9"]))).toEqual(new Set());
  });
});

describe("erasing after 30 days", () => {
  it("is 30 days", () => {
    expect(BIN_DAYS).toBe(30);
  });

  it("dates the erase 30 days after deleting", () => {
    expect(eraseDate(T)).toEqual(new Date(T.getTime() + 30 * DAY));
  });

  it("is due from exactly 30 days, not a moment before", () => {
    expect(isDueForErasing(T, new Date(T.getTime() + 30 * DAY - 1))).toBe(false);
    expect(isDueForErasing(T, new Date(T.getTime() + 30 * DAY))).toBe(true);
  });
});

describe("deleteSentence", () => {
  it("describes a course with its sheets, questions and attempts", () => {
    expect(
      deleteSentence({
        kind: "course",
        name: "Analysis I",
        sheets: 3,
        questions: 24,
        attempts: 41,
      }),
    ).toBe(
      "This deletes Analysis I with its 3 sheets, 24 questions and 41 attempts. You can restore it from Recently deleted for 30 days.",
    );
  });

  it("uses the singular for one, and leaves out a zero count", () => {
    expect(
      deleteSentence({
        kind: "sheet",
        name: "Problem Sheet 1",
        sheets: 0,
        questions: 1,
        attempts: 0,
      }),
    ).toBe(
      "This deletes Problem Sheet 1 with its 1 question. You can restore it from Recently deleted for 30 days.",
    );
    expect(
      deleteSentence({ kind: "course", name: "C", sheets: 1, questions: 2, attempts: 1 }),
    ).toBe(
      "This deletes C with its 1 sheet, 2 questions and 1 attempt. You can restore it from Recently deleted for 30 days.",
    );
  });

  it("says nothing about contents when everything is zero", () => {
    expect(
      deleteSentence({ kind: "course", name: "Empty", sheets: 0, questions: 0, attempts: 0 }),
    ).toBe("This deletes Empty. You can restore it from Recently deleted for 30 days.");
  });
});
