import { describe, expect, it } from "vitest";

import { focusTopics, type TopicForFocus } from "./insights";

const now = new Date("2026-11-15T12:00:00Z");
const daysBefore = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

const topic = (over: Partial<TopicForFocus> & { id: string }): TopicForFocus => ({
  name: over.id,
  mastery: 0.5,
  confidence: 0.5,
  priority: 0.5,
  attempts: 3,
  series: [{ at: daysBefore(2), mastery: over.mastery ?? 0.5 }],
  ...over,
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
});
