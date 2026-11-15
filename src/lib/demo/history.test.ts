import { describe, expect, it } from "vitest";

import {
  DEMO_MISCONCEPTIONS,
  mulberry32,
  planDemoHistory,
  type DemoQuestion,
  type PlannedAttempt,
} from "./history";

const COURSES = ["Numbers", "Analysis I", "Sequences and Series"];

/** Sheets 1 and 2 of three courses, 8 questions each, two topics per sheet. */
function sampleQuestions(perSheet = 8): DemoQuestion[] {
  return COURSES.flatMap((course) =>
    ([1, 2] as const).flatMap((sheet) =>
      Array.from({ length: perSheet }, (_, i) => ({
        id: `${course}-${sheet}-${i + 1}`,
        course,
        sheet,
        topics: [`${course} topic ${sheet}${i % 3}`],
      })),
    ),
  );
}

const share = (plan: PlannedAttempt[], outcome: string) =>
  plan.filter((a) => a.outcome === outcome).length / plan.length;

describe("mulberry32", () => {
  it("gives the same numbers in [0, 1) for the same seed, and others for another seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const c = mulberry32(8);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(c()).not.toBe(first[0]);
    for (const x of first) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe("planDemoHistory", () => {
  const questions = sampleQuestions();
  const plan = planDemoHistory(questions, { seed: 42, days: 21 });

  it("attempts every question once, and a few of them again", () => {
    for (const q of questions)
      expect(plan.filter((a) => a.questionId === q.id && !a.repeat)).toHaveLength(1);
    const repeats = plan.filter((a) => a.repeat);
    expect(repeats.length).toBeGreaterThanOrEqual(2);
    expect(repeats.length).toBeLessThan(questions.length / 3);
  });

  it("gives about 40% full, 35% partial and 25% stuck", () => {
    expect(share(plan, "full")).toBeCloseTo(0.4, 1);
    expect(share(plan, "partial")).toBeCloseTo(0.35, 1);
    expect(share(plan, "stuck")).toBeCloseTo(0.25, 1);
  });

  it("reveals hints on about a third of the attempts, at levels 1 to 3", () => {
    const withHints = plan.filter((a) => a.hintLevel > 0);
    expect(withHints.length / plan.length).toBeCloseTo(1 / 3, 1);
    for (const a of plan) expect([0, 1, 2, 3]).toContain(a.hintLevel);
    expect(new Set(withHints.map((a) => a.hintLevel)).size).toBeGreaterThan(1);
  });

  it("shows a misconception on every attempt that is not full, and none on a full one", () => {
    for (const a of plan) {
      if (a.outcome === "full") expect(a.misconception).toBeNull();
      else expect(DEMO_MISCONCEPTIONS.map((m) => m.key)).toContain(a.misconception);
    }
  });

  it("repeats each of 3 or 4 misconceptions at least twice and in at least two courses", () => {
    const used = new Set(plan.flatMap((a) => (a.misconception ? [a.misconception] : [])));
    expect(used.size).toBeGreaterThanOrEqual(3);
    expect(used.size).toBeLessThanOrEqual(4);
    for (const key of used) {
      const shown = plan.filter((a) => a.misconception === key);
      expect(shown.length).toBeGreaterThanOrEqual(2);
      expect(new Set(shown.map((a) => a.course)).size).toBeGreaterThanOrEqual(2);
    }
  });

  it("spreads the days over three weeks, in order, ending on the last day", () => {
    const days = plan.map((a) => a.day);
    expect(days).toEqual([...days].sort((x, y) => x - y));
    expect(Math.min(...days)).toBe(0);
    expect(Math.max(...days)).toBe(20);
    expect(new Set(days).size).toBeGreaterThanOrEqual(15);
    for (let week = 0; week < 3; week++)
      expect(days.filter((d) => d >= week * 7 && d < week * 7 + 7).length).toBeGreaterThan(3);
  });

  it("does sheet 1 before sheet 2 in each course, and a repeat after the first attempt", () => {
    const first = plan.filter((a) => !a.repeat);
    for (const course of COURSES) {
      const one = first.filter((a) => a.course === course && a.sheet === 1).map((a) => a.day);
      const two = first.filter((a) => a.course === course && a.sheet === 2).map((a) => a.day);
      expect(Math.max(...one)).toBeLessThan(Math.min(...two));
    }
    plan.forEach((a, index) => {
      if (!a.repeat) return;
      const earlier = plan.findIndex((b) => b.questionId === a.questionId);
      expect(earlier).toBeLessThan(index);
      expect(plan[earlier].day).toBeLessThan(a.day);
      expect(plan[earlier].outcome).not.toBe("full");
    });
  });

  it("leaves some topics strong and some weak at the end", () => {
    const latest = new Map<string, PlannedAttempt>();
    for (const a of plan) latest.set(a.questionId, a);
    const byTopic = new Map<string, number[]>();
    for (const a of latest.values()) {
      const topic = questions.find((q) => q.id === a.questionId)!.topics[0];
      const score = a.outcome === "full" ? 1 : a.outcome === "partial" ? 0.5 : 0;
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), score]);
    }
    const means = [...byTopic.values()].map((s) => s.reduce((x, y) => x + y, 0) / s.length);
    expect(Math.max(...means)).toBeGreaterThanOrEqual(0.75);
    expect(Math.min(...means)).toBeLessThanOrEqual(0.35);
    // A repeat either recovers (full) or stays weak.
    const repeats = plan.filter((a) => a.repeat);
    expect(repeats.some((a) => a.outcome === "full")).toBe(true);
    expect(repeats.some((a) => a.outcome !== "full")).toBe(true);
  });

  it("is deterministic for a seed and changes with the seed", () => {
    expect(planDemoHistory(questions, { seed: 42, days: 21 })).toEqual(plan);
    expect(planDemoHistory(questions, { seed: 43, days: 21 })).not.toEqual(plan);
  });

  it("does not depend on the order of the input", () => {
    expect(planDemoHistory([...questions].reverse(), { seed: 42, days: 21 })).toEqual(plan);
  });

  it("defaults to 21 days", () => {
    expect(planDemoHistory(questions, { seed: 42 })).toEqual(plan);
  });

  it("plans a small single-sheet course, with no topics, without failing", () => {
    const small: DemoQuestion[] = Array.from({ length: 4 }, (_, i) => ({
      id: `q${i}`,
      course: "Numbers",
      sheet: 1,
      topics: [],
    }));
    const result = planDemoHistory(small, { seed: 1, days: 21 });
    expect(result.filter((a) => !a.repeat)).toHaveLength(4);
    expect(result.at(-1)!.day).toBe(20);
    expect(result.some((a) => a.outcome !== "full")).toBe(true);
  });

  it("returns nothing for no questions, and refuses fewer than 7 days", () => {
    expect(planDemoHistory([], { seed: 1 })).toEqual([]);
    expect(() => planDemoHistory(questions, { seed: 1, days: 6 })).toThrow(RangeError);
  });
});
