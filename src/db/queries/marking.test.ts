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
  sheets,
  solutions,
  submissions,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  getMarkScreenData,
  getRemarkProgress,
  getSolutionsReview,
  getVisibleSolution,
  DisputeRefusedError,
  startDispute,
} from "./marking";
import { performMark } from "@/lib/pipeline/mark";

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "Q",
      expectedMinutes: 5,
    })
    .returning();
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  return { user, question, attempt };
}

const mark = (attemptId: string, o: Partial<typeof marks.$inferInsert> = {}) => ({
  attemptId,
  basis: "ai" as const,
  score: 3,
  outcome: "partial" as const,
  errorType: "method" as const,
  feedback: "f",
  overallFeedback: "o",
  ...o,
});

describe("getMarkScreenData", () => {
  it("has no mark and no submission for an attempt that was never submitted", async () => {
    const { user, attempt } = await setup("ms-none@test.local");

    const data = await getMarkScreenData(user.id, attempt.id);

    expect(data.submission).toBeNull();
    expect(data.marks).toEqual([]);
    expect(data.current).toBeNull();
    expect(data.question.label).toBe("1");
  });

  it("returns the submission state and the marks, oldest first, with the current one", async () => {
    const { user, attempt } = await setup("ms-marks@test.local");
    await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "w", submittedAt: new Date(), markStatus: "done" });
    await db
      .insert(marks)
      .values(
        mark(attempt.id, { score: 2, outcome: "partial", createdAt: new Date(Date.now() - 2000) }),
      );
    await db.insert(marks).values(
      mark(attempt.id, {
        score: 5,
        outcome: "full",
        errorType: null,
        isDispute: true,
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    const data = await getMarkScreenData(user.id, attempt.id);

    expect(data.submission?.markStatus).toBe("done");
    expect(data.marks.map((m) => m.score)).toEqual([2, 5]);
    expect(data.current?.score).toBe(5);
  });

  it("prefers an official mark over a later AI mark", async () => {
    const { user, attempt } = await setup("ms-official@test.local");
    await db
      .insert(marks)
      .values(
        mark(attempt.id, { basis: "official", score: 4, createdAt: new Date(Date.now() - 2000) }),
      );
    await db.insert(marks).values(
      mark(attempt.id, {
        basis: "ai",
        score: 5,
        outcome: "full",
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    expect((await getMarkScreenData(user.id, attempt.id)).current?.basis).toBe("official");
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("ms-owner@test.local");
    const other = await setup("ms-other@test.local");

    await expect(getMarkScreenData(other.user.id, owner.attempt.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("getVisibleSolution", () => {
  async function withSolutions(email: string, official = false) {
    const base = await setup(email);
    await db
      .insert(solutions)
      .values({ questionId: base.question.id, basis: "ai", body: "AI worked solution" });
    if (official)
      await db.insert(solutions).values({
        questionId: base.question.id,
        basis: "official",
        body: "Official worked solution",
      });
    const hintRows = await db
      .insert(hints)
      .values(
        [1, 2, 3].map((level) => ({ questionId: base.question.id, level, body: `Hint ${level}` })),
      )
      .returning();
    return { ...base, hintRows };
  }
  const newAttempt = async (userId: string, questionId: string, inherited = 0) =>
    (
      await db
        .insert(attempts)
        .values({ userId, questionId, context: "sheet", inheritedHintLevel: inherited })
        .returning()
    )[0];
  const submit = (attemptId: string) =>
    db
      .insert(submissions)
      .values({ attemptId, text: "w", submittedAt: new Date(), markStatus: "done" });

  it("is locked before anything has been done", async () => {
    const { user, question } = await withSolutions("vs-locked@test.local");

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });

  it("is locked after a partial or stuck mark", async () => {
    const { user, question, attempt } = await withSolutions("vs-partial@test.local");
    await submit(attempt.id);
    await db.insert(marks).values(mark(attempt.id, { score: 3, outcome: "partial" }));
    const second = await newAttempt(user.id, question.id);
    await submit(second.id);
    await db.insert(marks).values(mark(second.id, { score: 0, outcome: "stuck" }));

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });

  it("unlocks after a full mark and shows the AI solution", async () => {
    const { user, question, attempt } = await withSolutions("vs-full@test.local");
    await submit(attempt.id);
    await db.insert(marks).values(mark(attempt.id, { score: 5, outcome: "full", errorType: null }));

    expect(await getVisibleSolution(user.id, question.id)).toEqual({
      basis: "ai",
      body: "AI worked solution",
    });
  });

  it("uses the official solution once the attempt's current mark is the official full one", async () => {
    const { user, question, attempt } = await withSolutions("vs-off@test.local", true);
    await submit(attempt.id);
    await db.insert(marks).values(mark(attempt.id, { score: 5, outcome: "full", errorType: null }));

    expect(await getVisibleSolution(user.id, question.id)).toEqual({
      basis: "official",
      body: "Official worked solution",
    });
  });

  it("does not unlock when an official partial mark replaced an earlier AI full mark", async () => {
    const { user, question, attempt } = await withSolutions("vs-overridden@test.local", true);
    await submit(attempt.id);
    await db.insert(marks).values(
      mark(attempt.id, {
        basis: "ai",
        score: 5,
        outcome: "full",
        errorType: null,
        createdAt: new Date(Date.now() - 2000),
      }),
    );
    await db.insert(marks).values(
      mark(attempt.id, {
        basis: "official",
        score: 3,
        outcome: "partial",
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });

  it("unlocks after all three hints were revealed, even across attempts", async () => {
    const { user, question, attempt, hintRows } = await withSolutions("vs-hints@test.local");
    const byLevel = (l: number) => hintRows.find((h) => h.level === l)!;
    await db.insert(hintReveals).values({ attemptId: attempt.id, hintId: byLevel(1).id });
    await db.insert(hintReveals).values({ attemptId: attempt.id, hintId: byLevel(2).id });
    expect(await getVisibleSolution(user.id, question.id)).toBeNull();

    // The retry inherits two hints and reveals the third.
    const retry = await newAttempt(user.id, question.id, 2);
    await db.insert(hintReveals).values({ attemptId: retry.id, hintId: byLevel(3).id });

    expect(await getVisibleSolution(user.id, question.id)).toEqual({
      basis: "ai",
      body: "AI worked solution",
    });
  });

  it("does not unlock because of another user's full mark", async () => {
    const owner = await withSolutions("vs-owner@test.local");
    await submit(owner.attempt.id);
    await db
      .insert(marks)
      .values(mark(owner.attempt.id, { score: 5, outcome: "full", errorType: null }));
    const other = await setup("vs-other@test.local");

    await expect(getVisibleSolution(other.user.id, owner.question.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("review mode unlocks for a submitted attempt when an official solution exists", async () => {
    const { user, question, attempt } = await withSolutions("vs-review@test.local", true);
    await submit(attempt.id);

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
    expect(await getVisibleSolution(user.id, question.id, { reviewMode: true })).toEqual({
      basis: "official",
      body: "Official worked solution",
    });
  });

  it("review mode stays locked without an official solution or without a submitted attempt", async () => {
    const noOfficial = await withSolutions("vs-review-no@test.local");
    await submit(noOfficial.attempt.id);
    const notSubmitted = await withSolutions("vs-review-draft@test.local", true);

    expect(
      await getVisibleSolution(noOfficial.user.id, noOfficial.question.id, { reviewMode: true }),
    ).toBeNull();
    expect(
      await getVisibleSolution(notSubmitted.user.id, notSubmitted.question.id, {
        reviewMode: true,
      }),
    ).toBeNull();
  });

  it("returns null, not an error, when the question has no solution yet", async () => {
    const { user, question, attempt } = await setup("vs-nosol@test.local");
    await submit(attempt.id);
    await db.insert(marks).values(mark(attempt.id, { score: 5, outcome: "full", errorType: null }));

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });
});

describe("getSolutionsReview", () => {
  async function sheetWith(email: string, n: number) {
    const base = await setup(email);
    const qs = [base.question];
    for (let i = 2; i <= n; i++) {
      const [q] = await db
        .insert(questions)
        .values({
          courseId: base.question.courseId,
          sheetId: base.question.sheetId,
          position: i,
          label: String(i),
          body: "Q",
          expectedMinutes: 5,
        })
        .returning();
      qs.push(q);
    }
    return { ...base, qs, sheetId: base.question.sheetId! };
  }

  async function attemptWith(userId: string, questionId: string, markRows: object[], text = "w") {
    const [attempt] = await db
      .insert(attempts)
      .values({ userId, questionId, context: "sheet" })
      .returning();
    await db.insert(submissions).values({ attemptId: attempt.id, text, submittedAt: new Date() });
    const base = Date.now() - 100000;
    for (const [i, row] of markRows.entries()) {
      await db
        .insert(marks)
        .values(mark(attempt.id, { ...row, createdAt: new Date(base + i * 1000) }));
    }
    return attempt;
  }

  it("lists changed marks first, then questions whose best outcome is not full", async () => {
    const { user, qs, sheetId } = await sheetWith("rv-order@test.local", 4);
    // Q1: ai full, official full: nothing to review.
    await attemptWith(user.id, qs[0].id, [
      { score: 5, outcome: "full" },
      { basis: "official", score: 5, outcome: "full" },
    ]);
    // Q2: ai partial, official partial: not full, not changed.
    const a2 = await attemptWith(user.id, qs[1].id, [
      { score: 3 },
      { basis: "official", score: 3, outcome: "partial" },
    ]);
    // Q3: ai full, official stuck: changed (comes first although it is later in the sheet).
    const a3 = await attemptWith(user.id, qs[2].id, [
      { score: 5, outcome: "full" },
      { basis: "official", score: 1, outcome: "stuck", outcomeChanged: true },
    ]);
    // Q4: unmarked by the official solutions yet, ai stuck.
    const a4 = await attemptWith(user.id, qs[3].id, [{ score: 0, outcome: "stuck" }]);

    const review = await getSolutionsReview(user.id, sheetId);

    expect(review.changed.map((i) => i.attemptId)).toEqual([a3.id]);
    expect(review.changed[0].earlierAi).toEqual({ score: 5, outcome: "full" });
    expect(review.changed[0].mark.basis).toBe("official");
    expect(review.notFull.map((i) => i.attemptId)).toEqual([a2.id, a4.id]);
  });

  it("uses the best attempt of a question and shows it once", async () => {
    const { user, qs, sheetId } = await sheetWith("rv-best@test.local", 1);
    await attemptWith(user.id, qs[0].id, [{ score: 2 }]);
    const good = await attemptWith(user.id, qs[0].id, [{ score: 4 }]);

    expect((await getSolutionsReview(user.id, sheetId)).notFull.map((i) => i.attemptId)).toEqual([
      good.id,
    ]);

    await attemptWith(user.id, qs[0].id, [{ score: 5, outcome: "full" }]);
    const after = await getSolutionsReview(user.id, sheetId);
    expect(after.notFull).toEqual([]);
  });

  it("does not list a changed attempt a second time, and ignores drafts", async () => {
    const { user, qs, sheetId } = await sheetWith("rv-dup@test.local", 1);
    const changed = await attemptWith(user.id, qs[0].id, [
      { score: 5, outcome: "full" },
      { basis: "official", score: 1, outcome: "stuck", outcomeChanged: true },
    ]);
    const [draft] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: qs[0].id, context: "sheet" })
      .returning();
    await db.insert(submissions).values({ attemptId: draft.id });

    const review = await getSolutionsReview(user.id, sheetId);
    expect(review.changed.map((i) => i.attemptId)).toEqual([changed.id]);
    expect(review.notFull).toEqual([]);
  });

  it("is not found for another user's sheet", async () => {
    const { sheetId } = await sheetWith("rv-own@test.local", 1);
    const [other] = await db.insert(users).values({ email: "rv-other@test.local" }).returning();

    await expect(getSolutionsReview(other.id, sheetId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRemarkProgress(other.id, sheetId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("counts progress of the official re-mark", async () => {
    const { user, qs, sheetId } = await sheetWith("rv-progress@test.local", 2);
    await db
      .insert(solutions)
      .values(qs.map((q) => ({ questionId: q.id, basis: "official" as const, body: "S" })));
    await attemptWith(user.id, qs[0].id, [{ score: 3 }, { basis: "official", score: 3 }]);
    await attemptWith(user.id, qs[1].id, [{ score: 3 }]);

    expect(await getRemarkProgress(user.id, sheetId)).toEqual({ total: 2, marked: 1 });
  });
});

describe("startDispute", () => {
  const io = (score: number) => ({
    readFile: async () => Buffer.from("x"),
    mark: async () => ({
      score,
      mistakes: [
        { type: "method" as const, quote: "s", hint: "h", location: { kind: "text" as const } },
      ],
      feedback: "f",
      overallFeedback: "o",
    }),
  });

  async function marked(email: string) {
    const base = await setup(email);
    await db.insert(solutions).values({ questionId: base.question.id, basis: "ai", body: "S" });
    await db.insert(submissions).values({
      attemptId: base.attempt.id,
      text: "w",
      submittedAt: new Date(),
      markStatus: "done",
    });
    await db
      .insert(marks)
      .values(mark(base.attempt.id, { createdAt: new Date(Date.now() - 5000) }));
    return base;
  }
  const allMarks = (attemptId: string) =>
    db.select().from(marks).where(eq(marks.attemptId, attemptId));

  it("adds a flagged mark with the reason and keeps the earlier one", async () => {
    const { user, attempt } = await marked("dp-basic@test.local");

    const claim = await startDispute(user.id, attempt.id, "  step 3 is correct  ");
    await performMark(claim, io(5));

    const rows = await allMarks(attempt.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((m) => m.isDispute)).toHaveLength(1);
    const disputed = rows.find((m) => m.isDispute)!;
    expect(disputed).toMatchObject({
      basis: "ai",
      score: 5,
      disputeReason: "step 3 is correct",
    });
    expect(rows.find((m) => !m.isDispute)!.score).toBe(3);
  });

  it("accepts a dispute with no reason", async () => {
    const { user, attempt } = await marked("dp-noreason@test.local");

    await performMark(await startDispute(user.id, attempt.id, undefined), io(3));

    const [disputed] = (await allMarks(attempt.id)).filter((m) => m.isDispute);
    expect(disputed.disputeReason).toBeNull();
  });

  it("refuses a third dispute on the server", async () => {
    const { user, attempt } = await marked("dp-limit@test.local");
    for (let i = 0; i < 2; i++) {
      await performMark(await startDispute(user.id, attempt.id, `try ${i}`), io(3));
    }

    await expect(startDispute(user.id, attempt.id, "again")).rejects.toBeInstanceOf(
      DisputeRefusedError,
    );
    expect(await allMarks(attempt.id)).toHaveLength(3);
  });

  it("keeps the basis of the current mark", async () => {
    const { user, attempt, question } = await marked("dp-basis@test.local");
    await db.insert(solutions).values({ questionId: question.id, basis: "official", body: "O" });
    await db.insert(marks).values(mark(attempt.id, { basis: "official", score: 2 }));

    await performMark(await startDispute(user.id, attempt.id, "r"), io(4));

    const disputed = (await allMarks(attempt.id)).find((m) => m.isDispute)!;
    expect(disputed.basis).toBe("official");
  });

  it("refuses a reason over 300 characters, an unsubmitted attempt and another user's attempt", async () => {
    const { user, attempt } = await marked("dp-bad@test.local");
    await expect(startDispute(user.id, attempt.id, "x".repeat(301))).rejects.toBeInstanceOf(
      DisputeRefusedError,
    );

    const fresh = await setup("dp-draft@test.local");
    await expect(startDispute(fresh.user.id, fresh.attempt.id, "r")).rejects.toBeInstanceOf(
      DisputeRefusedError,
    );

    const [other] = await db.insert(users).values({ email: "dp-other@test.local" }).returning();
    await expect(startDispute(other.id, attempt.id, "r")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses while the attempt is already being marked", async () => {
    const { user, attempt } = await marked("dp-busy@test.local");
    await startDispute(user.id, attempt.id, "first");

    await expect(startDispute(user.id, attempt.id, "second")).rejects.toBeInstanceOf(
      DisputeRefusedError,
    );
  });
});
