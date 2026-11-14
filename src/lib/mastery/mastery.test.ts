import { describe, expect, it } from "vitest";
import type { HintLevel, MarkBasis, Outcome } from "@/lib/domain";
import { evidenceScore, type MarkedAttempt } from "./evidence";
import { replayMastery } from "./mastery";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-01T09:00:00Z");

function attempt(o: Partial<MarkedAttempt> & { outcome?: Outcome } = {}): MarkedAttempt {
  return {
    at: T0,
    outcome: "full",
    hintLevel: 0,
    secondsSpent: null,
    expectedMinutes: 10,
    basis: "ai",
    ...o,
  };
}

describe("evidenceScore", () => {
  it.each([
    ["full", 1],
    ["partial", 0.5],
    ["stuck", 0],
  ] as const)("outcome %s at hint 0 is %f", (outcome, value) => {
    expect(evidenceScore(attempt({ outcome }))).toBe(value);
  });

  it.each([
    [0, 1],
    [1, 0.85],
    [2, 0.6],
    [3, 0.35],
  ] as const)("hint level %i multiplies by %f", (hintLevel, mult) => {
    expect(evidenceScore(attempt({ hintLevel: hintLevel as HintLevel }))).toBeCloseTo(mult);
  });

  it("multiplies by 0.9 when time is over twice the expected time", () => {
    expect(evidenceScore(attempt({ secondsSpent: 1201 }))).toBeCloseTo(0.9);
  });
  it("does not penalise exactly twice the expected time", () => {
    expect(evidenceScore(attempt({ secondsSpent: 1200 }))).toBe(1);
  });
  it("does not penalise an attempt with no time", () => {
    expect(evidenceScore(attempt({ secondsSpent: null }))).toBe(1);
  });
  it("combines outcome, hints and time", () => {
    expect(evidenceScore(attempt({ outcome: "partial", hintLevel: 2, secondsSpent: 99999 }))).toBeCloseTo(
      0.5 * 0.6 * 0.9,
    );
  });
});

describe("replayMastery", () => {
  it("returns the neutral start for no attempts", () => {
    const r = replayMastery([], T0);
    expect(r).toEqual({ mastery: 0.5, confidence: 0, priority: 1, attempts: 0, series: [] });
  });

  it("SC14: a full, unhinted attempt raises mastery", () => {
    expect(replayMastery([attempt()], T0).mastery).toBeGreaterThan(0.5);
  });

  it("SC14: a stuck attempt lowers mastery", () => {
    expect(replayMastery([attempt({ outcome: "stuck" })], T0).mastery).toBeLessThan(0.5);
  });

  it("SC14: the same outcome moves mastery less at hint level 3 than at level 0", () => {
    const unhinted = replayMastery([attempt({ hintLevel: 0 })], T0).mastery;
    const hinted = replayMastery([attempt({ hintLevel: 3 })], T0).mastery;
    expect(hinted).toBeLessThan(unhinted);
    expect(hinted - 0.5).toBeLessThan(unhinted - 0.5);
  });

  it("SC14: an official mark moves mastery twice as far as a provisional one", () => {
    const ai = replayMastery([attempt({ basis: "ai" })], T0).mastery - 0.5;
    const official = replayMastery([attempt({ basis: "official" })], T0).mastery - 0.5;
    expect(official).toBeCloseTo(2 * ai);
  });

  it("SC14: confidence halves after 30 days without attempts", () => {
    const attempts = [attempt({ basis: "official" }), attempt({ basis: "official" }), attempt({ basis: "official" }), attempt({ basis: "official" })];
    const fresh = replayMastery(attempts, T0).confidence;
    const later = replayMastery(attempts, new Date(T0.getTime() + 30 * DAY)).confidence;
    expect(fresh).toBe(1);
    expect(later).toBeCloseTo(0.5);
  });

  it("applies m ← m + 0.3·w·(e − m) with the exact constants", () => {
    // provisional full: 0.5 + 0.3 * 0.5 * 0.5 = 0.575
    expect(replayMastery([attempt()], T0).mastery).toBeCloseTo(0.575);
  });

  it("replays in time order whatever the input order", () => {
    const early = attempt({ at: new Date(T0.getTime() - 2 * DAY), outcome: "stuck" });
    const late = attempt({ at: T0, outcome: "full" });
    const a = replayMastery([late, early], T0);
    const b = replayMastery([early, late], T0);
    expect(a).toEqual(b);
    expect(a.series.map((s) => s.at)).toEqual([early.at, late.at]);
  });

  it("does not mutate its input", () => {
    const input = [attempt({ at: T0 }), attempt({ at: new Date(T0.getTime() - DAY) })];
    replayMastery(input, T0);
    expect(input[0].at).toBe(T0);
  });

  it("reports a series with the mastery after each attempt", () => {
    const r = replayMastery([attempt(), attempt({ at: new Date(T0.getTime() + DAY) })], T0);
    expect(r.attempts).toBe(2);
    expect(r.series).toHaveLength(2);
    expect(r.series[1].mastery).toBe(r.mastery);
    expect(r.series[0].mastery).toBeCloseTo(0.575);
  });

  it("confidence grows with total weight and caps at 1", () => {
    const n = (k: number) => replayMastery(Array.from({ length: k }, () => attempt()), T0).confidence;
    expect(n(1)).toBeCloseTo(0.125); // 0.5 / 4
    expect(n(8)).toBe(1); // 4 / 4
    expect(n(20)).toBe(1);
  });

  it("computes priority as (1 − m)(2 − c)", () => {
    const r = replayMastery([attempt()], T0);
    expect(r.priority).toBeCloseTo((1 - r.mastery) * (2 - r.confidence));
  });

  it("treats a clock earlier than the last attempt as zero days elapsed", () => {
    const r = replayMastery([attempt({ at: new Date(T0.getTime() + 5 * DAY) })], T0);
    expect(r.confidence).toBeCloseTo(0.125);
  });

  it("lets a weaker topic outrank a stronger one", () => {
    const weak = replayMastery([attempt({ outcome: "stuck" })], T0);
    const strong = replayMastery([attempt({ basis: "official" as MarkBasis })], T0);
    expect(weak.priority).toBeGreaterThan(strong.priority);
  });
});
