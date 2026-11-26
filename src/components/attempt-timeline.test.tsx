import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { timelineDots, type TimelineAttempt } from "@/lib/scores/timeline";

import { AttemptTimeline, attemptHref } from "./attempt-timeline";

const attempts = (count: number): TimelineAttempt[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `a${i + 1}`,
    date: new Date(Date.UTC(2026, 10, 20 + i, 12)),
    score: i % 3 === 0 ? 5 : i % 3 === 1 ? 3 : 1,
    outcome:
      i % 3 === 0 ? ("full" as const) : i % 3 === 1 ? ("partial" as const) : ("stuck" as const),
  }));

const html = (count: number, selected: string | null = null, sessionId?: string) =>
  renderToStaticMarkup(
    <AttemptTimeline
      dots={timelineDots(attempts(count), selected)}
      questionId="q1"
      sessionId={sessionId}
    />,
  );

describe("AttemptTimeline", () => {
  it("shows nothing with a single attempt", () => {
    expect(html(1)).toBe("");
  });

  it("shows one dot per attempt, oldest first, each linking to its attempt", () => {
    const out = html(3);
    expect(out.match(/<a /g)).toHaveLength(3);
    expect(out.indexOf("a1")).toBeLessThan(out.indexOf("a3"));
    expect(out).toContain('href="/questions/q1?attempt=a2"');
  });

  it("gives each dot an accessible name and rings the newest by default", () => {
    const out = html(3);
    expect(out).toContain('aria-label="Attempt 2, 21 November, 3 out of 5, partial"');
    expect(out).toContain('aria-label="Attempt 3, 22 November, 1 out of 5, stuck"');
    // Only the selected dot is current, and only it is in the tab order.
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-label="Attempt 3[^"]*" aria-current="true" tabindex="0"/);
    expect(out.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it("selects the attempt in the address", () => {
    const out = html(3, "a1");
    expect(out).toMatch(/aria-label="Attempt 1[^"]*" aria-current="true"/);
  });

  it("collapses the oldest attempts from the seventh on", () => {
    const out = html(8);
    expect(out).toContain("+2 earlier");
    expect(out.match(/<a /g)).toHaveLength(6);
    // Choosing a hidden attempt shows them all.
    expect(html(8, "a1")).not.toContain("earlier");
    expect(html(8, "a1").match(/<a /g)).toHaveLength(8);
  });

  it("does not collapse six attempts", () => {
    expect(html(6)).not.toContain("earlier");
  });

  it("keeps the revision session in the links", () => {
    expect(html(2, null, "s1")).toContain("attempt=a1&amp;session=s1");
    expect(attemptHref("q1", "a1", "s1")).toBe("/questions/q1?attempt=a1&session=s1");
  });
});
