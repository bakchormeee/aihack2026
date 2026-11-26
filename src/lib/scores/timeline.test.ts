import { describe, expect, it } from "vitest";

import {
  MAX_VISIBLE_DOTS,
  dayLabel,
  focusAfterKey,
  timelineDots,
  visibleDots,
  type TimelineAttempt,
} from "./timeline";

const attempt = (n: number, score: number | null = null): TimelineAttempt => ({
  id: `a${n}`,
  date: new Date(Date.UTC(2026, 10, 20 + n, 12)),
  score,
  outcome: score === null ? null : score >= 4 ? "full" : score >= 2 ? "partial" : "stuck",
});

describe("dayLabel", () => {
  it("is the day and month in London", () => {
    expect(dayLabel(new Date("2026-11-24T12:00:00Z"))).toBe("24 November");
    // 23:30 UTC in summer is already the next day in London.
    expect(dayLabel(new Date("2026-07-01T23:30:00Z"))).toBe("2 July");
  });
});

describe("timelineDots", () => {
  it("names each dot with its number, date, score and outcome", () => {
    const dots = timelineDots([attempt(1, 4), attempt(4, 2)], null);
    expect(dots.map((d) => d.name)).toEqual([
      "Attempt 1, 21 November, 4 out of 5, full",
      "Attempt 2, 24 November, 2 out of 5, partial",
    ]);
  });

  it("selects the newest by default, or the one asked for", () => {
    const list = [attempt(1, 1), attempt(2, 2), attempt(3, 3)];
    expect(timelineDots(list, null).map((d) => d.selected)).toEqual([false, false, true]);
    expect(timelineDots(list, "a1").map((d) => d.selected)).toEqual([true, false, false]);
    expect(timelineDots(list, "unknown").map((d) => d.selected)).toEqual([false, false, true]);
  });

  it("says when an attempt has no mark yet", () => {
    expect(timelineDots([attempt(1)], null)[0]).toMatchObject({
      name: "Attempt 1, 21 November, not marked yet",
      outcome: null,
    });
  });

  it("has no dots without attempts", () => {
    expect(timelineDots([], null)).toEqual([]);
  });
});

describe("visibleDots", () => {
  const dots = (count: number, selected: string | null = null) =>
    timelineDots(
      Array.from({ length: count }, (_, i) => attempt(i + 1, 3)),
      selected,
    );

  it("shows up to six attempts in full", () => {
    expect(visibleDots(dots(MAX_VISIBLE_DOTS), false)).toMatchObject({ hiddenCount: 0 });
    expect(visibleDots(dots(MAX_VISIBLE_DOTS), false).shown).toHaveLength(6);
  });

  it("collapses the oldest from the seventh attempt on", () => {
    const { shown, hiddenCount } = visibleDots(dots(7), false);
    expect(hiddenCount).toBe(1);
    expect(shown.map((d) => d.number)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(visibleDots(dots(9), false).hiddenCount).toBe(3);
  });

  it("shows them all once expanded, or when the selected one is hidden", () => {
    expect(visibleDots(dots(8), true)).toMatchObject({ hiddenCount: 0 });
    expect(visibleDots(dots(8), true).shown).toHaveLength(8);
    expect(visibleDots(dots(8, "a1"), false).shown).toHaveLength(8);
  });
});

describe("focusAfterKey", () => {
  it("moves with the arrow keys and stays inside the row", () => {
    expect(focusAfterKey("ArrowRight", 1, 4)).toBe(2);
    expect(focusAfterKey("ArrowDown", 1, 4)).toBe(2);
    expect(focusAfterKey("ArrowRight", 3, 4)).toBe(3);
    expect(focusAfterKey("ArrowLeft", 1, 4)).toBe(0);
    expect(focusAfterKey("ArrowUp", 1, 4)).toBe(0);
    expect(focusAfterKey("ArrowLeft", 0, 4)).toBe(0);
  });

  it("jumps to the ends with Home and End, and ignores other keys", () => {
    expect(focusAfterKey("Home", 2, 4)).toBe(0);
    expect(focusAfterKey("End", 1, 4)).toBe(3);
    expect(focusAfterKey("Enter", 1, 4)).toBeNull();
    expect(focusAfterKey("a", 1, 4)).toBeNull();
  });
});
