import { describe, expect, it } from "vitest";

import { isSlow, type MarkedAttempt } from "@/lib/mastery/evidence";

import {
  collapseByDay,
  dayToDate,
  gradeOf,
  isReviewDue,
  londonDay,
  replaySchedule,
  type Grade,
} from "./review";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-02T10:00:00Z");

function attempt(o: Partial<MarkedAttempt> = {}): MarkedAttempt {
  return {
    at: T0,
    outcome: "full",
    score: 5,
    hintLevel: 0,
    secondsSpent: null,
    expectedMinutes: 10,
    basis: "ai",
    ...o,
  };
}

/** One review a day apart from the previous one, starting at T0. */
const daily = (grades: Grade[], gapDays = 1) =>
  grades.map((grade, i) => ({ at: new Date(T0.getTime() + i * gapDays * DAY), grade }));

describe("isSlow", () => {
  it("is true only past twice the expected time, and never without a time", () => {
    expect(isSlow(attempt({ secondsSpent: 20 * 60 }))).toBe(false);
    expect(isSlow(attempt({ secondsSpent: 20 * 60 + 1 }))).toBe(true);
    expect(isSlow(attempt({ secondsSpent: null }))).toBe(false);
  });
});

describe("gradeOf", () => {
  it("grades long-form attempts from the outcome, hints and time", () => {
    expect(gradeOf(attempt({ outcome: "stuck" }))).toBe("again");
    expect(gradeOf(attempt({ outcome: "partial" }))).toBe("hard");
    expect(gradeOf(attempt({ hintLevel: 3 }))).toBe("hard");
    expect(gradeOf(attempt({ hintLevel: 2 }))).toBe("hard");
    expect(gradeOf(attempt({ hintLevel: 1 }))).toBe("good");
    expect(gradeOf(attempt({ secondsSpent: 21 * 60 }))).toBe("good");
    expect(gradeOf(attempt({ secondsSpent: 5 * 60 }))).toBe("easy");
    expect(gradeOf(attempt())).toBe("easy");
  });

  it("grades spot-the-error answers from the outcome only", () => {
    expect(gradeOf(attempt({ kind: "spot", outcome: "stuck" }))).toBe("again");
    expect(gradeOf(attempt({ kind: "spot", outcome: "partial" }))).toBe("hard");
    expect(gradeOf(attempt({ kind: "spot", outcome: "full" }))).toBe("good");
  });
});

describe("londonDay", () => {
  it("counts days in UK time, in winter and in summer time", () => {
    // Winter: UK time is UTC.
    expect(londonDay(new Date("2026-12-01T23:30:00Z"))).toBe(
      londonDay(new Date("2026-12-01T00:00:00Z")),
    );
    // Summer: 23:30 UTC is already the next day in London.
    expect(londonDay(new Date("2026-06-01T23:30:00Z"))).toBe(
      londonDay(new Date("2026-06-02T12:00:00Z")),
    );
    expect(
      londonDay(new Date("2026-06-02T12:00:00Z")) - londonDay(new Date("2026-06-01T12:00:00Z")),
    ).toBe(1);
  });

  it("turns a day back into a date at midnight UTC of that calendar day", () => {
    expect(dayToDate(londonDay(new Date("2026-06-01T23:30:00Z"))).toISOString()).toBe(
      "2026-06-02T00:00:00.000Z",
    );
  });
});

describe("collapseByDay", () => {
  it("keeps one review a day, with the worst grade, at the time of the last one", () => {
    const morning = new Date("2026-11-02T08:00:00Z");
    const evening = new Date("2026-11-02T20:00:00Z");
    const next = new Date("2026-11-03T09:00:00Z");
    expect(
      collapseByDay([
        { at: next, grade: "easy" },
        { at: evening, grade: "good" },
        { at: morning, grade: "again" },
      ]),
    ).toEqual([
      { day: londonDay(morning), at: evening, grade: "again" },
      { day: londonDay(next), at: next, grade: "easy" },
    ]);
  });
});

describe("replaySchedule", () => {
  it("is null with no reviews", () => {
    expect(replaySchedule([], T0)).toBeNull();
  });

  it("uses the first intervals 1, 1, 3 and 4 days", () => {
    const first = (grade: Grade) => replaySchedule(daily([grade]), T0)!.interval;
    expect([first("again"), first("hard"), first("good"), first("easy")]).toEqual([1, 1, 3, 4]);
  });

  it("follows SM-2 through a known sequence of grades", () => {
    const steps = (["good", "good", "easy", "hard", "again", "good"] as Grade[]).map((_, i, all) =>
      replaySchedule(daily(all.slice(0, i + 1)), T0),
    );
    expect(steps.map((s) => [s!.interval, s!.ease])).toEqual([
      [3, 2.5], // first Good
      [8, 2.5], // 3 × 2.5 = 7.5, rounded
      [26, 2.65], // 8 × 2.5 × 1.3, ease +0.15
      [31, 2.5], // 26 × 1.2 = 31.2, ease −0.15
      [1, 2.3], // Again, ease −0.20
      [2, 2.3], // 1 × 2.3 = 2.3, rounded to 2
    ]);
  });

  it("makes each later interval at least one day longer, except after Again", () => {
    // After Again the interval is 1; Hard gives 1 × 1.2 = 1.2, rounded to 1, so it becomes 2.
    const s = replaySchedule(daily(["again", "hard"]), T0)!;
    expect(s.interval).toBe(2);
  });

  it("never lets the ease fall below 1.3", () => {
    const s = replaySchedule(daily(Array<Grade>(10).fill("again")), T0)!;
    expect(s.ease).toBe(1.3);
  });

  it("caps the interval at 365 days", () => {
    const s = replaySchedule(daily(Array<Grade>(8).fill("easy"), 400), T0)!;
    expect(s.interval).toBe(365);
  });

  it("gives no bonus for a late review", () => {
    const onTime = replaySchedule(daily(["good", "good"], 3), T0)!;
    const late = replaySchedule(daily(["good", "good"], 30), T0)!;
    expect(late.interval).toBe(onTime.interval);
  });

  it("counts several reviews on one day as one, with the worst grade", () => {
    const sameDay = [
      { at: new Date("2026-11-02T08:00:00Z"), grade: "easy" as Grade },
      { at: new Date("2026-11-02T18:00:00Z"), grade: "again" as Grade },
    ];
    expect(replaySchedule(sameDay, T0)).toMatchObject({ interval: 1, ease: 2.3, reviews: 1 });
  });

  it("dates the next review from the day of the last one, and says how far away it is", () => {
    const last = new Date("2026-11-02T10:00:00Z");
    const s = replaySchedule([{ at: last, grade: "good" }], new Date("2026-11-03T09:00:00Z"))!;
    expect(s.lastDay).toBe(londonDay(last));
    expect(s.dueDay).toBe(londonDay(last) + 3);
    expect(s.daysUntilDue).toBe(2);
    expect(isReviewDue(s)).toBe(false);

    const overdue = replaySchedule(
      [{ at: last, grade: "good" }],
      new Date("2026-11-08T09:00:00Z"),
    )!;
    expect(overdue.daysUntilDue).toBe(-3);
    expect(isReviewDue(overdue)).toBe(true);
  });
});
