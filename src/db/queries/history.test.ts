import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  sheetSummaries,
  sheets,
  submissionFiles,
  submissions,
  topics,
  users,
} from "@/db/schema";
import type { ErrorType, Outcome } from "@/lib/domain";

import { startAttemptFor } from "./attempts";
import { binCourse, binSheet, restoreSheet } from "./bin";
import {
  claimSummary,
  failSummary,
  finishSummary,
  getCourseSheetOverview,
  getSheetScore,
  getSheetHistory,
  getSheetQuestionStatuses,
  getSheetSummaryInput,
  latestSubmitted,
  markOfQuestion,
  statusOfQuestion,
  listMistakes,
  readSummary,
  retrySummary,
  summaryIsStale,
} from "./history";

const T0 = new Date("2026-11-01T10:00:00Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

async function world(email: string, labels: string[] = ["1", "2"]) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "Sheet A", status: "ready", uploadedAt: at(0) })
    .returning();
  const [algebra] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Algebra" })
    .returning();
  const [calculus] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Calculus" })
    .returning();
  const qs = [];
  for (const [i, label] of labels.entries()) {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label,
        body: `Body ${label}`,
        expectedMinutes: 5,
      })
      .returning();
    await db
      .insert(questionTopics)
      .values({ questionId: q.id, topicId: i % 2 === 0 ? algebra.id : calculus.id });
    await db
      .insert(hints)
      .values([1, 2, 3].map((level) => ({ questionId: q.id, level, body: `h${level}` })));
    qs.push(q);
  }
  return { user, course, sheet, algebra, calculus, qs };
}

type MarkSpec = {
  score: number;
  outcome: Outcome;
  basis?: "ai" | "official";
  errorType?: ErrorType | null;
  feedback?: string;
  at: number;
};

async function addAttempt(
  userId: string,
  questionId: string,
  o: {
    startedAt: number;
    seconds?: number | null;
    inherited?: number;
    reveals?: number[];
    submitted?: boolean;
    /** Defaults to done. */
    markStatus?: "none" | "pending" | "done" | "failed" | "awaiting_official";
    text?: string;
    files?: { path: string; mime: string }[];
    marks?: MarkSpec[];
  },
) {
  const [attempt] = await db
    .insert(attempts)
    .values({
      userId,
      questionId,
      context: "sheet",
      startedAt: at(o.startedAt),
      secondsSpent: o.seconds ?? null,
      inheritedHintLevel: o.inherited ?? 0,
    })
    .returning();
  for (const level of o.reveals ?? []) {
    const rows = await db.select().from(hints).where(eq(hints.questionId, questionId));
    await db
      .insert(hintReveals)
      .values({ attemptId: attempt.id, hintId: rows.find((h) => h.level === level)!.id });
  }
  if (o.submitted !== false && (o.submitted || o.marks || o.text || o.files)) {
    const [submission] = await db
      .insert(submissions)
      .values({
        attemptId: attempt.id,
        text: o.text ?? "x = 1",
        submittedAt: at(o.startedAt + 1),
        markStatus: o.markStatus ?? "done",
      })
      .returning();
    for (const [i, file] of (o.files ?? []).entries())
      await db
        .insert(submissionFiles)
        .values({ submissionId: submission.id, ...file, position: i });
  }
  for (const m of o.marks ?? []) {
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: m.basis ?? "ai",
      score: m.score,
      outcome: m.outcome,
      errorType: m.errorType === undefined ? "method" : m.errorType,
      feedback: m.feedback ?? "fb",
      overallFeedback: "ov",
      createdAt: at(m.at),
    });
  }
  return attempt;
}

describe("getSheetHistory", () => {
  it("returns every question with all attempts, marks, hints and files", async () => {
    const w = await world("h-hist@test.local");
    const [q1, q2] = w.qs;
    const a1 = await addAttempt(w.user.id, q1.id, {
      startedAt: 1,
      seconds: 120,
      reveals: [1, 2],
      text: "first",
      marks: [
        { score: 2, outcome: "partial", at: 5 },
        { score: 5, outcome: "full", basis: "official", at: 50 },
      ],
    });
    const a2 = await addAttempt(w.user.id, q1.id, {
      startedAt: 20,
      seconds: 60,
      inherited: 0,
      files: [{ path: "u/x/a.png", mime: "image/png" }],
      marks: [{ score: 5, outcome: "full", at: 25 }],
    });
    await addAttempt(w.user.id, q2.id, { startedAt: 30, submitted: false });

    const history = await getSheetHistory(w.user.id, w.sheet.id);

    expect(history.map((q) => q.question.label)).toEqual(["1", "2"]);
    expect(history[0].topics.map((t) => t.name)).toEqual(["Algebra"]);
    expect(history[0].attempts.map((a) => a.id)).toEqual([a1.id, a2.id]);
    const first = history[0].attempts[0];
    expect(first.hintLevel).toBe(2);
    expect(first.secondsSpent).toBe(120);
    expect(first.marks.map((m) => m.score)).toEqual([2, 5]);
    expect(first.current?.basis).toBe("official");
    expect(first.submission?.text).toBe("first");
    expect(history[0].attempts[1].submission?.files).toHaveLength(1);
    expect(history[1].attempts[0].submission).toBeNull();
    expect(history[1].attempts[0].current).toBeNull();
  });

  it("includes inherited hints in the hint level", async () => {
    const w = await world("h-inh@test.local", ["1"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      inherited: 2,
      reveals: [1],
      submitted: true,
    });
    const [q] = await getSheetHistory(w.user.id, w.sheet.id);
    expect(q.attempts[0].hintLevel).toBe(2);
  });

  it("returns nothing for another user's sheet", async () => {
    const w = await world("h-own@test.local");
    const other = await world("h-own-other@test.local");
    await addAttempt(w.user.id, w.qs[0].id, { startedAt: 1, submitted: true });
    expect(await getSheetHistory(other.user.id, w.sheet.id)).toEqual([]);
  });

  it("does not show another user's attempts on the same question", async () => {
    const w = await world("h-att@test.local", ["1"]);
    const other = await world("h-att-other@test.local", ["1"]);
    await addAttempt(other.user.id, w.qs[0].id, { startedAt: 1, submitted: true });
    const [q] = await getSheetHistory(w.user.id, w.sheet.id);
    expect(q.attempts).toEqual([]);
  });

  it("Try again starts a fresh attempt with hint level 0 and leaves the old one untouched", async () => {
    const w = await world("h-fresh@test.local", ["1"]);
    const old = await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      reveals: [1, 2, 3],
      marks: [{ score: 3, outcome: "partial", at: 3 }],
    });

    const fresh = await startAttemptFor(w.user.id, w.qs[0].id, "fresh");

    const [q] = await getSheetHistory(w.user.id, w.sheet.id);
    expect(q.attempts).toHaveLength(2);
    const [before, after] = q.attempts;
    expect(after.id).toBe(fresh.id);
    expect(after.hintLevel).toBe(0);
    expect(before.id).toBe(old.id);
    expect(before.hintLevel).toBe(3);
    expect(before.marks).toHaveLength(1);
    expect(before.submission?.submittedAt).not.toBeNull();
  });
});

describe("getCourseSheetOverview", () => {
  it("scores the latest mark of attempted questions, adds hints and time, and flags confirmed marks", async () => {
    const w = await world("h-ov@test.local", ["1", "2", "3"]);
    const [q1, q2] = w.qs;
    await addAttempt(w.user.id, q1.id, {
      startedAt: 1,
      seconds: 100,
      reveals: [1],
      marks: [{ score: 2, outcome: "partial", at: 5 }],
    });
    await addAttempt(w.user.id, q1.id, {
      startedAt: 10,
      seconds: 50,
      reveals: [1, 2],
      marks: [{ score: 4, outcome: "full", at: 15 }],
    });
    await addAttempt(w.user.id, q2.id, {
      startedAt: 20,
      seconds: null,
      marks: [{ score: 3, outcome: "partial", at: 25 }],
    });

    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);

    expect(row.sheet.id).toBe(w.sheet.id);
    expect(row.stats).toEqual({
      // Questions 1 and 2 are attempted (4 and 3); question 3 is not and does not lower it.
      score: { attempted: 2, total: 3, points: 7, max: 10, percent: 70 },
      hintsRevealed: 3,
      secondsSpent: 150,
      confirmed: false,
    });
    expect(row.heat.cells.map((c) => c.outcome)).toEqual(["full", "partial", null]);
  });

  it("scores the spec's example: question 2 is 4/5, 9 / 10 and Attempted 2 / 4", async () => {
    const w = await world("h-ex@test.local", ["1", "2(a)", "2(b)", "3", "4"]);
    const [q1, q2a, q2b, q3] = w.qs;
    const full = { score: 5, outcome: "full" as const, at: 5 };
    await addAttempt(w.user.id, q1.id, { startedAt: 1, marks: [full] });
    await addAttempt(w.user.id, q2a.id, { startedAt: 1, marks: [full] });
    await addAttempt(w.user.id, q2b.id, {
      startedAt: 1,
      marks: [{ score: 3, outcome: "partial", at: 5 }],
    });
    await addAttempt(w.user.id, q3.id, { startedAt: 1, submitted: true, markStatus: "pending" });

    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.stats.score).toEqual({ attempted: 2, total: 4, points: 9, max: 10, percent: 90 });
    expect(await getSheetScore(w.user.id, w.sheet.id)).toEqual(row.stats.score);
  });

  it("counts a question by its latest submitted attempt, not the best", async () => {
    const w = await world("h-latest-score@test.local", ["1"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [{ score: 5, outcome: "full", at: 5 }],
    });
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 10,
      marks: [{ score: 2, outcome: "partial", at: 15 }],
    });
    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.stats.score).toMatchObject({ points: 2, max: 5, percent: 40 });
  });

  it("is confirmed once any mark is official, and an official mark beats the AI mark", async () => {
    const w = await world("h-conf@test.local", ["1"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [
        { score: 5, outcome: "full", at: 5 },
        { score: 2, outcome: "partial", basis: "official", at: 6 },
      ],
    });
    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.stats.confirmed).toBe(true);
    expect(row.stats.score.points).toBe(2);
    expect(row.heat.cells[0].outcome).toBe("partial");
  });

  it("has no score for an unmarked sheet", async () => {
    const w = await world("h-nomark@test.local");
    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.stats.score).toEqual({ attempted: 0, total: 2, points: 0, max: 0, percent: null });
  });

  it("heat cell takes the best outcome, then fewest hints", async () => {
    const w = await world("h-heat@test.local", ["1"]);
    const q = w.qs[0];
    await addAttempt(w.user.id, q.id, {
      startedAt: 1,
      reveals: [1, 2, 3],
      marks: [{ score: 5, outcome: "full", at: 2 }],
    });
    await addAttempt(w.user.id, q.id, {
      startedAt: 5,
      reveals: [1],
      marks: [{ score: 5, outcome: "full", at: 6 }],
    });
    await addAttempt(w.user.id, q.id, {
      startedAt: 9,
      marks: [{ score: 1, outcome: "stuck", at: 10 }],
    });
    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.heat.cells).toEqual([
      { label: "1", outcome: "full", hintLevel: 1, questionId: expect.any(String) },
    ]);
  });

  it("ignores another user's data and course", async () => {
    const w = await world("h-ovu@test.local");
    const other = await world("h-ovu-other@test.local");
    await addAttempt(other.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [{ score: 5, outcome: "full", at: 2 }],
    });
    expect(await getCourseSheetOverview(other.user.id, w.course.id)).toEqual([]);
    const [row] = await getCourseSheetOverview(w.user.id, w.course.id);
    expect(row.stats.score.attempted).toBe(0);
  });
});

describe("listMistakes", () => {
  async function seeded(email: string) {
    const w = await world(email, ["1", "2", "3"]);
    const [q1, q2, q3] = w.qs; // topics: Algebra, Calculus, Algebra
    await addAttempt(w.user.id, q1.id, {
      startedAt: 1,
      marks: [{ score: 2, outcome: "partial", errorType: "method", feedback: "old", at: 2 }],
    });
    await addAttempt(w.user.id, q2.id, {
      startedAt: 10,
      marks: [{ score: 0, outcome: "stuck", errorType: "conceptual", feedback: "c", at: 11 }],
    });
    await addAttempt(w.user.id, q3.id, {
      startedAt: 20,
      marks: [{ score: 5, outcome: "full", errorType: null, at: 21 }],
    });
    // Unmarked attempt: not a mistake.
    await addAttempt(w.user.id, q3.id, { startedAt: 30, submitted: false });
    return w;
  }

  it("lists attempts whose current outcome is not full, newest first", async () => {
    const w = await seeded("h-mis@test.local");
    const { items } = await listMistakes(w.user.id, w.course.id, {});
    expect(items.map((i) => [i.label, i.outcome, i.errorType, i.feedback, i.sheet?.title])).toEqual(
      [
        ["2", "stuck", "conceptual", "c", "Sheet A"],
        ["1", "partial", "method", "old", "Sheet A"],
      ],
    );
    expect(items[1].topics.map((t) => t.name)).toEqual(["Algebra"]);
  });

  it("uses the current mark: an official full mark removes the mistake", async () => {
    const w = await seeded("h-mis-off@test.local");
    const a = await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 40,
      marks: [
        { score: 1, outcome: "stuck", at: 41 },
        { score: 5, outcome: "full", basis: "official", at: 42 },
      ],
    });
    const { items } = await listMistakes(w.user.id, w.course.id, {});
    expect(items.find((i) => i.attemptId === a.id)).toBeUndefined();
  });

  it("filters by topic", async () => {
    const w = await seeded("h-mis-topic@test.local");
    const { items } = await listMistakes(w.user.id, w.course.id, { topicId: w.calculus.id });
    expect(items.map((i) => i.label)).toEqual(["2"]);
  });

  it("filters by error type, and by both", async () => {
    const w = await seeded("h-mis-err@test.local");
    expect(
      (await listMistakes(w.user.id, w.course.id, { errorType: "method" })).items.map(
        (i) => i.label,
      ),
    ).toEqual(["1"]);
    expect(
      (await listMistakes(w.user.id, w.course.id, { errorType: "method", topicId: w.calculus.id }))
        .items,
    ).toEqual([]);
  });

  it("offers filter options from the unfiltered mistakes", async () => {
    const w = await seeded("h-mis-opt@test.local");
    const result = await listMistakes(w.user.id, w.course.id, { errorType: "method" });
    expect(result.topics.map((t) => t.name).sort()).toEqual(["Algebra", "Calculus"]);
    expect(result.errorTypes.sort()).toEqual(["conceptual", "method"]);
  });

  it("returns nothing for another user", async () => {
    const w = await seeded("h-mis-u@test.local");
    const other = await world("h-mis-u-other@test.local");
    expect((await listMistakes(other.user.id, w.course.id, {})).items).toEqual([]);
  });
});

describe("getSheetSummaryInput", () => {
  it("is incomplete until every question has a marked attempt, and counts what remains", async () => {
    const w = await world("h-sum@test.local", ["1", "2", "3"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [{ score: 5, outcome: "full", at: 2 }],
    });
    await addAttempt(w.user.id, w.qs[1].id, { startedAt: 3, submitted: true }); // submitted, not marked
    const input = await getSheetSummaryInput(w.user.id, w.sheet.id);
    expect(input).toMatchObject({ total: 3, marked: 1, complete: false });
  });

  it("uses each question's newest marked attempt for items and the hint ladder", async () => {
    const w = await world("h-sum2@test.local", ["1", "2", "3"]);
    const [q1, q2, q3] = w.qs;
    // q1: first full with 3 hints, newest full with none -> level 0
    await addAttempt(w.user.id, q1.id, {
      startedAt: 1,
      reveals: [1, 2, 3],
      marks: [{ score: 5, outcome: "full", at: 2 }],
    });
    await addAttempt(w.user.id, q1.id, {
      startedAt: 10,
      marks: [{ score: 5, outcome: "full", at: 11 }],
    });
    // q2: full with 2 hints
    await addAttempt(w.user.id, q2.id, {
      startedAt: 3,
      reveals: [1, 2],
      marks: [{ score: 5, outcome: "full", at: 4 }],
    });
    // q3: partial (not solved)
    await addAttempt(w.user.id, q3.id, {
      startedAt: 5,
      reveals: [1],
      marks: [{ score: 3, outcome: "partial", errorType: "algebra_slip", feedback: "slip", at: 6 }],
    });
    // an unmarked later attempt does not replace the marked one
    await addAttempt(w.user.id, q3.id, { startedAt: 50, submitted: true });

    const input = await getSheetSummaryInput(w.user.id, w.sheet.id);

    expect(input.complete).toBe(true);
    expect(input.ladder).toEqual([1, 0, 1, 0]);
    expect(input.newestMarkAt).toEqual(at(11));
    expect(input.items[2]).toEqual({
      label: "3",
      topics: ["Algebra"],
      outcome: "partial",
      hintLevel: 1,
      errorType: "algebra_slip",
      feedback: "slip",
    });
  });

  it("is empty for another user's sheet", async () => {
    const w = await world("h-sum3@test.local");
    const other = await world("h-sum3-other@test.local");
    const input = await getSheetSummaryInput(other.user.id, w.sheet.id);
    expect(input).toMatchObject({ total: 0, complete: false, items: [] });
  });
});

describe("summaryIsStale", () => {
  it("is stale with no summary, or when a mark is newer than the summary", () => {
    expect(summaryIsStale(null, at(5))).toBe(true);
    expect(summaryIsStale(at(10), at(11))).toBe(true);
  });
  it("is fresh when the summary is at least as new as the newest mark", () => {
    expect(summaryIsStale(at(10), at(10))).toBe(false);
    expect(summaryIsStale(at(10), at(3))).toBe(false);
    expect(summaryIsStale(at(10), null)).toBe(false);
  });
});

describe("summary claim", () => {
  const body = { wentWell: ["a"], wasHard: [], nextSteps: ["n"] };

  it("lets only one caller claim, then stores the result", async () => {
    const w = await world("h-claim@test.local");
    const first = await claimSummary(w.user.id, w.sheet.id, at(50));
    const second = await claimSummary(w.user.id, w.sheet.id, at(50));
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await readSummary(w.user.id, w.sheet.id))?.state).toBe("generating");

    await finishSummary(w.sheet.id, first!, body);
    const done = await readSummary(w.user.id, w.sheet.id);
    expect(done).toMatchObject({ state: "ready", body });
    expect(done?.generatedAt).toEqual(first);
  });

  it("claims again when a newer mark makes the stored summary stale, once", async () => {
    const w = await world("h-reclaim@test.local");
    const claimed = await claimSummary(w.user.id, w.sheet.id, at(1));
    await finishSummary(w.sheet.id, claimed!, body);
    // A mark at minute 0 is older than the summary: no claim.
    expect(await claimSummary(w.user.id, w.sheet.id, at(0))).toBeNull();
    const [s] = await db
      .select()
      .from(sheetSummaries)
      .where(eq(sheetSummaries.sheetId, w.sheet.id));
    const newer = new Date(s.generatedAt.getTime() + 60_000);
    const [a, b] = await Promise.all([
      claimSummary(w.user.id, w.sheet.id, newer),
      claimSummary(w.user.id, w.sheet.id, newer),
    ]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
  });

  it("reclaims an abandoned claim after the stale limit", async () => {
    const w = await world("h-abandon@test.local");
    await claimSummary(w.user.id, w.sheet.id, at(0));
    await db
      .update(sheetSummaries)
      .set({ generatedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(sheetSummaries.sheetId, w.sheet.id));
    expect(await claimSummary(w.user.id, w.sheet.id, at(0))).not.toBeNull();
  });

  it("records a failure, which a retry clears", async () => {
    const w = await world("h-fail@test.local");
    const claimed = await claimSummary(w.user.id, w.sheet.id, at(1));
    await failSummary(w.sheet.id, claimed!);
    expect((await readSummary(w.user.id, w.sheet.id))?.state).toBe("failed");
    expect(await claimSummary(w.user.id, w.sheet.id, at(1))).toBeNull();
    await retrySummary(w.user.id, w.sheet.id);
    expect(await readSummary(w.user.id, w.sheet.id)).toBeNull();
  });

  it("does not claim or read another user's sheet", async () => {
    const w = await world("h-claim-u@test.local");
    const other = await world("h-claim-u-other@test.local");
    expect(await claimSummary(other.user.id, w.sheet.id, at(1))).toBeNull();
    expect(await readSummary(other.user.id, w.sheet.id)).toBeNull();
  });
});

describe("history and the bin", () => {
  it("leaves a binned sheet and the variants of its questions out of the overview and the mistake log, until restored", async () => {
    const w = await world("h-bin@test.local");
    const [sheetB] = await db
      .insert(sheets)
      .values({ courseId: w.course.id, title: "Sheet B", status: "ready", uploadedAt: at(10) })
      .returning();
    const [qb] = await db
      .insert(questions)
      .values({
        courseId: w.course.id,
        sheetId: sheetB.id,
        position: 1,
        label: "B1",
        body: "B",
        expectedMinutes: 5,
      })
      .returning();
    const [variant] = await db
      .insert(questions)
      .values({
        courseId: w.course.id,
        sheetId: null,
        position: 1,
        label: "1 (variant)",
        body: "V",
        expectedMinutes: 5,
        source: "variant",
        parentQuestionId: w.qs[0].id,
      })
      .returning();
    const stuck = { marks: [{ score: 0, outcome: "stuck" as const, at: 30 }] };
    await addAttempt(w.user.id, w.qs[0].id, { startedAt: 20, ...stuck });
    await addAttempt(w.user.id, variant.id, { startedAt: 21, ...stuck });
    await addAttempt(w.user.id, qb.id, { startedAt: 22, ...stuck });

    const overviewIds = async () =>
      (await getCourseSheetOverview(w.user.id, w.course.id)).map((o) => o.sheet.id).sort();
    const mistakeQuestions = async () =>
      (await listMistakes(w.user.id, w.course.id, {})).items.map((i) => i.questionId).sort();

    expect(await overviewIds()).toEqual([w.sheet.id, sheetB.id].sort());
    expect(await mistakeQuestions()).toEqual([w.qs[0].id, variant.id, qb.id].sort());

    await binSheet(w.user.id, w.sheet.id);
    expect(await overviewIds()).toEqual([sheetB.id]);
    expect(await mistakeQuestions()).toEqual([qb.id]);
    expect(await getSheetHistory(w.user.id, w.sheet.id)).toEqual([]);

    await restoreSheet(w.user.id, w.sheet.id);
    expect(await overviewIds()).toEqual([w.sheet.id, sheetB.id].sort());
    expect(await mistakeQuestions()).toEqual([w.qs[0].id, variant.id, qb.id].sort());
    expect(await getSheetHistory(w.user.id, w.sheet.id)).toHaveLength(2);
  });

  it("shows nothing of a binned course", async () => {
    const w = await world("h-bin-course@test.local");
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [{ score: 0, outcome: "stuck", at: 2 }],
    });
    await binCourse(w.user.id, w.course.id);

    expect(await getCourseSheetOverview(w.user.id, w.course.id)).toEqual([]);
    expect((await listMistakes(w.user.id, w.course.id, {})).items).toEqual([]);
    expect(await getSheetHistory(w.user.id, w.sheet.id)).toEqual([]);
  });
});

describe("the mark of a question (question-marks)", () => {
  it("is the latest submitted attempt's mark, not the best", async () => {
    const w = await world("h-latest@test.local", ["1"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [{ score: 5, outcome: "full", at: 5 }],
    });
    const second = await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 20,
      marks: [{ score: 2, outcome: "partial", at: 25 }],
    });
    const [record] = await getSheetHistory(w.user.id, w.sheet.id);

    expect(latestSubmitted(record)?.id).toBe(second.id);
    expect(markOfQuestion(record)?.score).toBe(2);
    expect(statusOfQuestion(record)).toMatchObject({
      kind: "marked",
      score: 2,
      outcomeLabel: "Partial",
      attempts: 2,
    });
  });

  it("uses the official mark once it exists", async () => {
    const w = await world("h-official@test.local", ["1"]);
    await addAttempt(w.user.id, w.qs[0].id, {
      startedAt: 1,
      marks: [
        { score: 2, outcome: "partial", at: 5 },
        { score: 4, outcome: "full", basis: "official", at: 9 },
      ],
    });
    const [record] = await getSheetHistory(w.user.id, w.sheet.id);
    expect(statusOfQuestion(record)).toMatchObject({
      kind: "marked",
      score: 4,
      outcomeLabel: "Correct, slips",
    });
  });

  it("gives each question its status", async () => {
    const w = await world("h-status@test.local", ["1", "2", "3", "4", "5", "6"]);
    const [q1, q2, q3, q4, q5] = w.qs;
    await addAttempt(w.user.id, q1.id, {
      startedAt: 1,
      marks: [{ score: 5, outcome: "full", at: 5 }],
    });
    await addAttempt(w.user.id, q2.id, { startedAt: 1, submitted: true, markStatus: "pending" });
    await addAttempt(w.user.id, q3.id, {
      startedAt: 1,
      submitted: true,
      markStatus: "awaiting_official",
    });
    await addAttempt(w.user.id, q4.id, { startedAt: 1, submitted: true, markStatus: "failed" });
    // A draft: a submission row that was never submitted, and one with no working.
    const draft = await addAttempt(w.user.id, q5.id, { startedAt: 1, submitted: false });
    await db.insert(submissions).values({ attemptId: draft.id, text: "half done" });

    const statuses = await getSheetQuestionStatuses(w.user.id, w.sheet.id);

    expect(w.qs.map((q) => statuses[q.id].kind)).toEqual([
      "marked",
      "marking",
      "waiting",
      "failed",
      "draft",
      "none",
    ]);
  });

  it("shows an empty submission row as not started, and gives nothing for another user's sheet", async () => {
    const w = await world("h-empty@test.local", ["1"]);
    const attempt = await addAttempt(w.user.id, w.qs[0].id, { startedAt: 1, submitted: false });
    await db.insert(submissions).values({ attemptId: attempt.id, text: "  " });
    expect((await getSheetQuestionStatuses(w.user.id, w.sheet.id))[w.qs[0].id]).toEqual({
      kind: "none",
    });

    const other = await world("h-empty2@test.local", ["1"]);
    expect(await getSheetQuestionStatuses(other.user.id, w.sheet.id)).toEqual({});
  });
});
