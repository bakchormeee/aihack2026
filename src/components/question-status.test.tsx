import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { QuestionStatus } from "@/lib/scores/status";

import { QuestionStatusView } from "./question-status";

const html = (status: QuestionStatus) =>
  renderToStaticMarkup(<QuestionStatusView status={status} />);

describe("QuestionStatusView", () => {
  it("shows nothing for a question that was not started", () => {
    expect(html({ kind: "none" })).toBe("");
  });

  it("shows a pill for each state, as text", () => {
    expect(html({ kind: "draft" })).toContain("Draft");
    expect(html({ kind: "marking" })).toContain("Marking…");
    expect(html({ kind: "waiting" })).toContain("Waiting for official solution");
    expect(html({ kind: "failed" })).toContain("Marking failed");
  });

  it("shows the score as text, the outcome in words and the pips as decoration", () => {
    const out = html({
      kind: "marked",
      score: 3,
      outcome: "partial",
      outcomeLabel: "Partial",
      attempts: 1,
    });
    expect(out).toContain("3 / 5");
    expect(out).toContain("Partial");
    expect(out).not.toContain("attempts");
    expect(out).toContain('aria-hidden="true"');
  });

  it("adds the number of attempts when there are several", () => {
    const out = html({
      kind: "marked",
      score: 4,
      outcome: "full",
      outcomeLabel: "Correct, slips",
      attempts: 3,
    });
    expect(out).toContain("Correct, slips · 3 attempts");
  });
});
