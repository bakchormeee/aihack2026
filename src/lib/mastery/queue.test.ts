import { describe, expect, it } from "vitest";
import type { HintLevel, Outcome } from "@/lib/domain";
import { buildQueue, type Candidate } from "./queue";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-14T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

function cand(id: string, o: Partial<Candidate> = {}): Candidate {
  return {
    questionId: id,
    topicIds: ["t1"],
    expectedMinutes: 10,
    lastAttemptAt: ago(10),
    lastOutcome: "partial",
    lastHintLevel: 0,
    consecutiveFull: 0,
    label: `Q ${id}`,
    ...o,
  };
}

const build = (
  candidates: Candidate[],
  targetMinutes: number,
  priorityByTopic: Record<string, number> = { t1: 1 },
) => buildQueue({ candidates, priorityByTopic, targetMinutes, now: NOW });

describe("buildQueue ranking", () => {
  it("ranks by the highest priority among a candidate's topics", () => {
    const { items } = build(
      [cand("low", { topicIds: ["a"] }), cand("high", { topicIds: ["a", "b"] })],
      40,
      { a: 0.2, b: 1.8 },
    );
    expect(items.filter((i) => i.source === "retry").map((i) => i.questionId)).toEqual([
      "high",
      "low",
    ]);
  });

  it("puts due candidates before not-yet-due ones, whatever their priority", () => {
    const due = cand("due", { topicIds: ["a"], lastAttemptAt: ago(2), lastOutcome: "partial" });
    const notDue = cand("notDue", {
      topicIds: ["b"],
      lastAttemptAt: ago(2),
      lastOutcome: "full",
      lastHintLevel: 2,
      consecutiveFull: 2,
    });
    const { items } = build([notDue, due], 40, { a: 0.1, b: 1.9 });
    expect(items.map((i) => i.questionId).slice(0, 2)).toEqual(["due", "notDue"]);
  });

  it("treats a candidate with no known topic priority as priority 0", () => {
    const { items } = build([cand("unknown", { topicIds: ["zzz"] }), cand("known")], 20, {
      t1: 0.5,
    });
    expect(items[0].questionId).toBe("known");
  });

  it("treats a candidate with no topics as priority 0", () => {
    const { items } = build([cand("none", { topicIds: [] }), cand("known")], 20, { t1: 0.5 });
    expect(items[0].questionId).toBe("known");
  });

  it("breaks ties by oldest last attempt, then by question id", () => {
    const { items } = build(
      [
        cand("b", { lastAttemptAt: ago(10) }),
        cand("c", { lastAttemptAt: ago(20) }),
        cand("a", { lastAttemptAt: ago(10) }),
      ],
      60,
    );
    expect(items.filter((i) => i.source === "retry").map((i) => i.questionId)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("buildQueue due intervals", () => {
  const dueAfter = (
    consecutiveFull: number,
    days: number,
    outcome: Outcome = "full",
    hint: HintLevel = 2,
  ) => {
    const due = cand("due", {
      lastOutcome: outcome,
      lastHintLevel: hint,
      consecutiveFull,
      lastAttemptAt: ago(days),
      topicIds: ["a"],
    });
    const other = cand("other", {
      lastOutcome: "partial",
      lastAttemptAt: ago(0.5),
      topicIds: ["b"],
    });
    // `other` is never due (0.5 days < 1 day), so it comes first only when `due` is not due.
    const { items } = build([other, due], 40, { a: 1, b: 2 });
    return items[0].questionId === "due";
  };

  it("is due 1 day after a non-full outcome", () => {
    expect(dueAfter(5, 1, "partial", 0)).toBe(true);
    expect(dueAfter(5, 0.9, "partial", 0)).toBe(false);
  });
  it("is due 1 day after the first full", () => {
    expect(dueAfter(1, 1)).toBe(true);
    expect(dueAfter(1, 0.9)).toBe(false);
  });
  it("is due 3 days after the second consecutive full", () => {
    expect(dueAfter(2, 3)).toBe(true);
    expect(dueAfter(2, 2.9)).toBe(false);
  });
  it("is due 7 days after the third consecutive full", () => {
    expect(dueAfter(3, 7)).toBe(true);
    expect(dueAfter(3, 6.9)).toBe(false);
  });
  it("is due 14 days after the fourth and later consecutive fulls", () => {
    expect(dueAfter(4, 14)).toBe(true);
    expect(dueAfter(4, 13.9)).toBe(false);
    expect(dueAfter(9, 13.9)).toBe(false);
  });
  it("uses the 1-day interval when consecutiveFull is 0 after a full", () => {
    expect(dueAfter(0, 1)).toBe(true);
  });
});

describe("buildQueue budget", () => {
  it("gives retries about 60% of the time and variants about 40%", () => {
    const cands = ["a", "b", "c", "d", "e", "f"].map((id) => cand(id));
    const { items } = build(cands, 50);
    const minutes = (s: string) => items.filter((i) => i.source === s).length * 10;
    expect(minutes("retry")).toBe(30);
    expect(minutes("variant")).toBe(20);
  });

  it("never exceeds the target minutes", () => {
    const cands = Array.from({ length: 10 }, (_, i) => cand(`q${i}`, { expectedMinutes: 7 }));
    const { items } = build(cands, 45);
    expect(items.length * 7).toBeLessThanOrEqual(45);
  });

  it("skips a retry that does not fit and takes a smaller one behind it", () => {
    const { items } = build(
      [cand("big", { expectedMinutes: 30 }), cand("small", { expectedMinutes: 5 })],
      20,
    );
    const retries = items.filter((i) => i.source === "retry").map((i) => i.questionId);
    expect(retries).toEqual(["small"]);
  });

  it("uses variants for the rest when retry candidates run out", () => {
    const { items } = build([cand("a")], 45);
    expect(items.map((i) => i.source)).toEqual(["retry", "variant"]);
    expect(items[0]).toMatchObject({ source: "retry", questionId: "a" });
    expect(items.filter((i) => i.source === "variant")).toHaveLength(1);
  });

  it("uses variants for all of the time when no retry fits", () => {
    const { items } = build([cand("a", { expectedMinutes: 15 })], 20);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "variant", questionId: "a" });
  });

  it("makes variants of candidates not already retried before those that are", () => {
    const cands = ["a", "b", "c", "d"].map((id) => cand(id));
    const { items } = build(cands, 40);
    const retried = items.filter((i) => i.source === "retry").map((i) => i.questionId);
    const varied = items.filter((i) => i.source === "variant").map((i) => i.questionId);
    expect(retried).toEqual(["a", "b"]);
    expect(varied).toEqual(["c", "d"]);
  });

  it("makes at most one variant per parent", () => {
    const { items } = build([cand("a", { expectedMinutes: 5 })], 60);
    expect(items.filter((i) => i.source === "variant")).toHaveLength(1);
  });

  it("returns nothing for no candidates", () => {
    expect(build([], 45).items).toEqual([]);
  });

  it("returns nothing when nothing fits", () => {
    expect(build([cand("a", { expectedMinutes: 90 })], 20).items).toEqual([]);
  });

  it("lists retry items before variant items", () => {
    const { items } = build(
      ["a", "b", "c", "d"].map((id) => cand(id)),
      40,
    );
    expect(items.map((i) => i.source)).toEqual(["retry", "retry", "variant", "variant"]);
  });
});

describe("buildQueue reasons", () => {
  const reasonOf = (c: Candidate) => build([c], 30).items[0].reason;

  it("mentions hints used on a full attempt, with the age", () => {
    expect(
      reasonOf(cand("a", { lastOutcome: "full", lastHintLevel: 3, lastAttemptAt: ago(12) })),
    ).toBe("you used 3 hints on this 12 days ago");
  });
  it("uses the singular for one day and one hint", () => {
    expect(
      reasonOf(cand("a", { lastOutcome: "full", lastHintLevel: 1, lastAttemptAt: ago(1) })),
    ).toBe("you used 1 hint on this 1 day ago");
  });
  it("says today for an attempt less than a day old", () => {
    expect(reasonOf(cand("a", { lastOutcome: "stuck", lastAttemptAt: ago(0.2) }))).toBe(
      "you got stuck on this today",
    );
  });
  it("describes a stuck outcome", () => {
    expect(reasonOf(cand("a", { lastOutcome: "stuck", lastAttemptAt: ago(4) }))).toBe(
      "you got stuck on this 4 days ago",
    );
  });
  it("describes a partial outcome and adds the hints used", () => {
    expect(
      reasonOf(cand("a", { lastOutcome: "partial", lastHintLevel: 2, lastAttemptAt: ago(6) })),
    ).toBe("you only got part of this 6 days ago, using 2 hints");
  });
  it("describes a clean full attempt that is due for spaced review", () => {
    expect(
      reasonOf(
        cand("a", {
          lastOutcome: "full",
          lastHintLevel: 0,
          consecutiveFull: 1,
          lastAttemptAt: ago(2),
        }),
      ),
    ).toBe("due for spaced review, last done 2 days ago");
  });
  it("names the parent question in a variant's reason", () => {
    const { items } = build(
      [cand("a", { expectedMinutes: 15, lastOutcome: "stuck", lastAttemptAt: ago(4) })],
      20,
    );
    expect(items[0].reason).toBe(
      "a fresh variant of Q a, because you got stuck on this 4 days ago",
    );
  });
});
