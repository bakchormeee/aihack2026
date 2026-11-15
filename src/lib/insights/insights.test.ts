import { describe, expect, it } from "vitest";

import { londonDay, type Schedule } from "@/lib/spaced/review";

import { focusTopics, reviewSummary, type TopicForFocus } from "./insights";

const now = new Date("2026-11-15T12:00:00Z");
const daysBefore = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

const topic = (over: Partial<TopicForFocus> & { id: string }): TopicForFocus => ({
  name: over.id,
  mastery: 0.5,
  confidence: 0.5,
  priority: 0.5,
  attempts: 3,
  series: [{ at: daysBefore(2), mastery: over.mastery ?? 0.5 }],
  review: null,
  ...over,
});

/** A schedule whose due day is `daysUntilDue` days from `now` (negative when overdue). */
const due = (daysUntilDue: number): Schedule => ({
  interval: 3,
  ease: 2.5,
  reviews: 1,
  lastDay: londonDay(now) + daysUntilDue - 3,
  dueDay: londonDay(now) + daysUntilDue,
  daysUntilDue,
});

describe("focusTopics", () => {
  it("orders by priority, leaves out secure topics, then adds untried ones", () => {
    const list = focusTopics(
      [
        topic({ id: "secure", mastery: 0.9, confidence: 0.8, priority: 0.9 }),
        topic({ id: "weak", mastery: 0.2, priority: 0.8 }),
        topic({ id: "middling", mastery: 0.55, priority: 0.4 }),
        topic({ id: "new", mastery: null, attempts: 0, series: [] }),
      ],
      now,
      5,
    );
    expect(list.map((t) => t.id)).toEqual(["weak", "middling", "new"]);
  });

  it("explains each pick in words", () => {
    const [stale, fresh, untried] = focusTopics(
      [
        topic({
          id: "a",
          mastery: 0.3,
          priority: 0.9,
          series: [{ at: daysBefore(12), mastery: 0.3 }],
        }),
        topic({ id: "b", mastery: 0.4, priority: 0.5, confidence: 0.2, attempts: 1 }),
        topic({ id: "c", mastery: null, attempts: 0, series: [] }),
      ],
      now,
    );
    expect(stale.reason).toBe("30% mastery from 3 attempts, last practised 12 days ago.");
    expect(stale.daysSince).toBe(12);
    expect(fresh.reason).toBe("40% mastery from 1 attempt, not much evidence yet.");
    expect(untried.reason).toMatch(/Not tried yet/);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 6 }, (_, i) => topic({ id: `t${i}`, priority: i / 10 }));
    expect(focusTopics(many, now, 2)).toHaveLength(2);
  });

  it("puts due and overdue topics first, most overdue first, even when they are secure", () => {
    const list = focusTopics(
      [
        topic({ id: "weak", mastery: 0.2, priority: 0.9, review: due(4) }),
        topic({ id: "today", mastery: 0.6, priority: 0.3, review: due(0) }),
        topic({ id: "secure", mastery: 0.9, confidence: 0.8, priority: 0.1, review: due(-1) }),
        topic({ id: "late", mastery: 0.7, priority: 0.2, review: due(-3) }),
        topic({ id: "new", mastery: null, attempts: 0, series: [] }),
      ],
      now,
      5,
    );
    expect(list.map((t) => t.id)).toEqual(["late", "secure", "today", "weak", "new"]);
  });

  it("orders topics due on the same day weakest first", () => {
    const list = focusTopics(
      [
        topic({ id: "strong", mastery: 0.7, review: due(-2) }),
        topic({ id: "weaker", mastery: 0.3, review: due(-2) }),
      ],
      now,
    );
    expect(list.map((t) => t.id)).toEqual(["weaker", "strong"]);
  });

  it("says when each review is due", () => {
    const [late, yesterday, today, soon, tomorrow, untried] = focusTopics(
      [
        topic({ id: "late", review: due(-3) }),
        topic({ id: "yesterday", review: due(-1) }),
        topic({ id: "today", review: due(0) }),
        topic({ id: "soon", priority: 0.9, review: due(3) }),
        topic({ id: "tomorrow", priority: 0.8, review: due(1) }),
        topic({ id: "untried", mastery: null, attempts: 0, series: [] }),
      ],
      now,
      6,
    );
    expect(late.due).toEqual({ text: "Overdue by 3 days", isDue: true });
    expect(yesterday.due).toEqual({ text: "Overdue by 1 day", isDue: true });
    expect(today.due).toEqual({ text: "Due today", isDue: true });
    expect(soon.due).toEqual({ text: "Next review in 3 days (18 Nov)", isDue: false });
    expect(tomorrow.due).toEqual({ text: "Next review in 1 day (16 Nov)", isDue: false });
    // The mastery bar of an untried topic already says "Not tried yet".
    expect(untried.due).toBeNull();
  });
});

describe("reviewSummary", () => {
  it("counts the due topics across the whole course", () => {
    expect(
      reviewSummary([
        topic({ id: "a", review: due(-2) }),
        topic({ id: "b", review: due(0) }),
        topic({ id: "c", review: due(5) }),
      ]),
    ).toBe("2 topics due for review.");
    expect(reviewSummary([topic({ id: "a", review: due(0) })])).toBe("1 topic due for review.");
  });

  it("gives the next review date when nothing is due, and nothing with no reviews", () => {
    expect(
      reviewSummary([topic({ id: "a", review: due(5) }), topic({ id: "b", review: due(3) })]),
    ).toBe("Nothing due. Next review on 18 Nov.");
    expect(reviewSummary([topic({ id: "a", mastery: null, attempts: 0 })])).toBeNull();
  });
});
