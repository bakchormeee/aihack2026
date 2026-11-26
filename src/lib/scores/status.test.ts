import { describe, expect, it } from "vitest";

import { outcomeLabel, questionStatus, type StatusInput } from "./status";

type Latest = NonNullable<StatusInput["latest"]>;

const base: StatusInput = { submittedAttempts: 0, latest: null, hasDraft: false };
const submitted = (
  markStatus: Latest["markStatus"],
  mark: Latest["mark"] = null,
  attempts = 1,
): StatusInput => ({ submittedAttempts: attempts, latest: { markStatus, mark }, hasDraft: false });

describe("questionStatus", () => {
  it("shows nothing for a question that was not started", () => {
    expect(questionStatus(base)).toEqual({ kind: "none" });
  });

  it("shows a draft when working is written but nothing is submitted", () => {
    expect(questionStatus({ ...base, hasDraft: true })).toEqual({ kind: "draft" });
  });

  it("shows the submitted attempt, not a newer draft", () => {
    const input = { ...submitted("pending"), hasDraft: true };
    expect(questionStatus(input)).toEqual({ kind: "marking" });
  });

  it("shows marking while the AI marks, and for a submission with no status yet", () => {
    expect(questionStatus(submitted("pending"))).toEqual({ kind: "marking" });
    expect(questionStatus(submitted("none"))).toEqual({ kind: "marking" });
    expect(questionStatus(submitted("done"))).toEqual({ kind: "marking" });
  });

  it("shows waiting for the official solution", () => {
    expect(questionStatus(submitted("awaiting_official"))).toEqual({ kind: "waiting" });
  });

  it("shows failed", () => {
    expect(questionStatus(submitted("failed"))).toEqual({ kind: "failed" });
  });

  it("shows the mark with one attempt", () => {
    expect(questionStatus(submitted("done", { score: 3, outcome: "partial" }))).toEqual({
      kind: "marked",
      score: 3,
      outcome: "partial",
      outcomeLabel: "Partial",
      attempts: 1,
    });
  });

  it("counts the attempts when there are several", () => {
    const status = questionStatus(submitted("done", { score: 2, outcome: "partial" }, 3));
    expect(status).toMatchObject({ kind: "marked", score: 2, attempts: 3 });
  });

  it("keeps the mark while a re-mark runs, and when a re-mark failed", () => {
    const mark = { score: 4, outcome: "full" as const };
    expect(questionStatus(submitted("pending", mark)).kind).toBe("marked");
    expect(questionStatus(submitted("failed", mark)).kind).toBe("marked");
  });

  it("calls a full outcome below 5 'Correct, slips'", () => {
    expect(questionStatus(submitted("done", { score: 4, outcome: "full" }))).toMatchObject({
      outcomeLabel: "Correct, slips",
    });
  });
});

describe("outcomeLabel", () => {
  it("names each outcome", () => {
    expect(outcomeLabel("full", 5)).toBe("Full marks");
    expect(outcomeLabel("full", 4)).toBe("Correct, slips");
    expect(outcomeLabel("partial", 3)).toBe("Partial");
    expect(outcomeLabel("stuck", 0)).toBe("Stuck");
  });
});
