import { describe, expect, it } from "vitest";

import {
  MAX_EXPLANATION,
  checkAnswer,
  dealQuestions,
  judgeLines,
  rankMisconceptions,
  spotOutcome,
  timesSeen,
  type MisconceptionInfo,
} from "./rules";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const info = (id: string, o: Partial<MisconceptionInfo> = {}): MisconceptionInfo => ({
  id,
  timesSeen: 1,
  lastSeen: day(1),
  topicIds: ["t1"],
  hidden: false,
  ...o,
});

describe("rankMisconceptions", () => {
  it("puts those seen twice or more first, most often seen first, then those seen once, most recent first", () => {
    const ranked = rankMisconceptions(
      [
        info("once-old", { timesSeen: 1, lastSeen: day(1) }),
        info("twice", { timesSeen: 2, lastSeen: day(2) }),
        info("once-new", { timesSeen: 1, lastSeen: day(9) }),
        info("thrice", { timesSeen: 3, lastSeen: day(1) }),
        info("twice-newer", { timesSeen: 2, lastSeen: day(5) }),
      ],
      null,
    );

    expect(ranked.map((m) => m.id)).toEqual([
      "thrice",
      "twice-newer",
      "twice",
      "once-new",
      "once-old",
    ]);
  });

  it("skips hidden misconceptions and ones never seen", () => {
    const ranked = rankMisconceptions(
      [info("a", { hidden: true, timesSeen: 5 }), info("b", { timesSeen: 0 }), info("c")],
      null,
    );

    expect(ranked.map((m) => m.id)).toEqual(["c"]);
  });

  it("keeps only misconceptions seen in the chosen topics, and all of them when none are chosen", () => {
    const list = [info("a", { topicIds: ["t1"] }), info("b", { topicIds: ["t2", "t3"] })];

    expect(rankMisconceptions(list, ["t3"]).map((m) => m.id)).toEqual(["b"]);
    expect(rankMisconceptions(list, []).map((m) => m.id)).toEqual(["a", "b"]);
    expect(rankMisconceptions(list, null).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("dealQuestions", () => {
  const rng = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

  it("gives about 1 in 5 questions no error and 1 in 5 two errors, the rest one", () => {
    for (const [count, zero, two] of [
      [5, 1, 1],
      [10, 2, 2],
      [15, 3, 3],
    ] as const) {
      const deal = dealQuestions(count, ids(6), rng([0.3, 0.7, 0.1]));

      expect(deal).toHaveLength(count);
      expect(deal.filter((q) => q.plant.length === 0)).toHaveLength(zero);
      expect(deal.filter((q) => q.plant.length === 2)).toHaveLength(two);
      expect(deal.filter((q) => q.plant.length === 1)).toHaveLength(count - zero - two);
    }
  });

  it("deals the misconceptions in turn, so none is used twice while others wait", () => {
    const deal = dealQuestions(5, ids(4), rng([0.5]));

    const used = deal.flatMap((q) => [...q.plant, ...(q.plant.length === 0 ? [q.focus] : [])]);
    expect(used.slice(0, 4)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(used[4]).toBe("m0");
  });

  it("uses two different misconceptions in a two-error question", () => {
    const deal = dealQuestions(10, ids(3), rng([0.2, 0.9, 0.5]));

    for (const q of deal) expect(new Set(q.plant).size).toBe(q.plant.length);
  });

  it("gives every question a focus misconception, the first planted one if it has any", () => {
    const deal = dealQuestions(10, ids(5), rng([0.4, 0.6]));

    for (const q of deal) expect(q.focus).toBe(q.plant[0] ?? q.focus);
    expect(deal.every((q) => typeof q.focus === "string")).toBe(true);
  });

  it("falls back to one error per question when only one misconception exists", () => {
    const deal = dealQuestions(5, ["only"], rng([0.5]));

    expect(deal.filter((q) => q.plant.length === 2)).toHaveLength(0);
    expect(deal.every((q) => q.focus === "only")).toBe(true);
  });

  it("deals nothing when there are no misconceptions or no questions", () => {
    expect(dealQuestions(5, [], rng([0.5]))).toEqual([]);
    expect(dealQuestions(0, ids(3), rng([0.5]))).toEqual([]);
  });

  it("puts the questions in a different order for a different random sequence", () => {
    const a = dealQuestions(10, ids(6), rng([0.01])).map((q) => q.plant.length);
    const b = dealQuestions(10, ids(6), rng([0.99])).map((q) => q.plant.length);

    expect(a).not.toEqual(b);
  });
});

describe("judgeLines", () => {
  it("sorts ticked lines into found, missed and wrongly accused", () => {
    expect(judgeLines([2, 5], [5, 7])).toEqual({ found: [5], missed: [2], wrong: [7] });
    expect(judgeLines([], [])).toEqual({ found: [], missed: [], wrong: [] });
  });
});

describe("spotOutcome", () => {
  const right = (...lines: number[]) => Object.fromEntries(lines.map((l) => [l, true]));

  it("is correct when exactly the planted lines are ticked and every explanation is right", () => {
    expect(spotOutcome({ planted: [3], ticked: [3], noError: false, explained: right(3) })).toBe(
      "full",
    );
    expect(
      spotOutcome({ planted: [2, 4], ticked: [4, 2], noError: false, explained: right(2, 4) }),
    ).toBe("full");
  });

  it("is correct to say no error on a question with none", () => {
    expect(spotOutcome({ planted: [], ticked: [], noError: true, explained: {} })).toBe("full");
  });

  it("is partly right when one error is found and explained but another is missed", () => {
    expect(spotOutcome({ planted: [2, 4], ticked: [2], noError: false, explained: right(2) })).toBe(
      "partial",
    );
  });

  it("is partly right when a planted error is found but a wrong line is also ticked", () => {
    expect(spotOutcome({ planted: [3], ticked: [3, 6], noError: false, explained: right(3) })).toBe(
      "partial",
    );
  });

  it("is partly right when both lines are found but one explanation is wrong", () => {
    expect(
      spotOutcome({
        planted: [2, 4],
        ticked: [2, 4],
        noError: false,
        explained: { 2: true, 4: false },
      }),
    ).toBe("partial");
  });

  it("is stuck when the right line is ticked but explained wrongly", () => {
    expect(
      spotOutcome({ planted: [3], ticked: [3], noError: false, explained: { 3: false } }),
    ).toBe("stuck");
  });

  it("is stuck when only wrong lines are ticked", () => {
    expect(spotOutcome({ planted: [3], ticked: [6], noError: false, explained: {} })).toBe("stuck");
  });

  it("is stuck to say no error on a question that has one", () => {
    expect(spotOutcome({ planted: [3], ticked: [], noError: true, explained: {} })).toBe("stuck");
  });

  it("is stuck to tick a line on a question that has no error, or to answer nothing", () => {
    expect(spotOutcome({ planted: [], ticked: [4], noError: false, explained: {} })).toBe("stuck");
    expect(spotOutcome({ planted: [], ticked: [], noError: false, explained: {} })).toBe("stuck");
    expect(spotOutcome({ planted: [3], ticked: [], noError: false, explained: {} })).toBe("stuck");
  });
});

describe("timesSeen", () => {
  it("counts distinct attempts whose current mark is the one a mistake came from", () => {
    const current = new Map([
      ["a1", "m2"],
      ["a2", "m5"],
      ["a3", "m9"],
    ]);

    expect(
      timesSeen(
        [
          { attemptId: "a1", markId: "m2" },
          { attemptId: "a1", markId: "m2" }, // two mistakes in one attempt count once
          { attemptId: "a2", markId: "m4" }, // an older mark that was superseded
          { attemptId: "a3", markId: "m9" },
          { attemptId: "gone", markId: "m1" },
        ],
        current,
      ),
    ).toBe(2);
  });
});

describe("checkAnswer", () => {
  const tick = (line: number, explanation = "It is wrong because the sign changes.") => ({
    line,
    explanation,
  });

  it("accepts ticked lines with an explanation each, or No error alone", () => {
    expect(checkAnswer(5, { noError: false, ticked: [tick(2), tick(4)] })).toBeNull();
    expect(checkAnswer(5, { noError: true, ticked: [] })).toBeNull();
  });

  it("needs either No error or at least one ticked line, not both", () => {
    expect(checkAnswer(5, { noError: false, ticked: [] })).toMatch(/tick the lines/i);
    expect(checkAnswer(5, { noError: true, ticked: [tick(2)] })).toMatch(/either/i);
  });

  it("needs real, distinct line numbers", () => {
    expect(checkAnswer(5, { noError: false, ticked: [tick(0)] })).toMatch(/line/i);
    expect(checkAnswer(5, { noError: false, ticked: [tick(6)] })).toMatch(/line/i);
    expect(checkAnswer(5, { noError: false, ticked: [tick(1.5)] })).toMatch(/line/i);
    expect(checkAnswer(5, { noError: false, ticked: [tick(2), tick(2)] })).toMatch(/once/i);
  });

  it("needs an explanation of 1 to 500 characters for every ticked line", () => {
    expect(checkAnswer(5, { noError: false, ticked: [tick(2, "   ")] })).toMatch(/explain/i);
    expect(
      checkAnswer(5, { noError: false, ticked: [tick(2, "x".repeat(MAX_EXPLANATION))] }),
    ).toBeNull();
    expect(
      checkAnswer(5, { noError: false, ticked: [tick(2, "x".repeat(MAX_EXPLANATION + 1))] }),
    ).toMatch(/500/);
  });
});
