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

import { getMarkScreenData, getVisibleSolution } from "./marking";

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
  score: 60,
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
        mark(attempt.id, { score: 40, outcome: "partial", createdAt: new Date(Date.now() - 2000) }),
      );
    await db.insert(marks).values(
      mark(attempt.id, {
        score: 95,
        outcome: "full",
        errorType: null,
        isDispute: true,
        createdAt: new Date(Date.now() - 1000),
      }),
    );

    const data = await getMarkScreenData(user.id, attempt.id);

    expect(data.submission?.markStatus).toBe("done");
    expect(data.marks.map((m) => m.score)).toEqual([40, 95]);
    expect(data.current?.score).toBe(95);
  });

  it("prefers an official mark over a later AI mark", async () => {
    const { user, attempt } = await setup("ms-official@test.local");
    await db
      .insert(marks)
      .values(
        mark(attempt.id, { basis: "official", score: 70, createdAt: new Date(Date.now() - 2000) }),
      );
    await db.insert(marks).values(
      mark(attempt.id, {
        basis: "ai",
        score: 99,
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
    await db.insert(marks).values(mark(attempt.id, { score: 60, outcome: "partial" }));
    const second = await newAttempt(user.id, question.id);
    await submit(second.id);
    await db.insert(marks).values(mark(second.id, { score: 5, outcome: "stuck" }));

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });

  it("unlocks after a full mark and shows the AI solution", async () => {
    const { user, question, attempt } = await withSolutions("vs-full@test.local");
    await submit(attempt.id);
    await db
      .insert(marks)
      .values(mark(attempt.id, { score: 95, outcome: "full", errorType: null }));

    expect(await getVisibleSolution(user.id, question.id)).toEqual({
      basis: "ai",
      body: "AI worked solution",
    });
  });

  it("uses the official solution once the attempt's current mark is the official full one", async () => {
    const { user, question, attempt } = await withSolutions("vs-off@test.local", true);
    await submit(attempt.id);
    await db
      .insert(marks)
      .values(mark(attempt.id, { score: 95, outcome: "full", errorType: null }));

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
        score: 95,
        outcome: "full",
        errorType: null,
        createdAt: new Date(Date.now() - 2000),
      }),
    );
    await db.insert(marks).values(
      mark(attempt.id, {
        basis: "official",
        score: 50,
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
      .values(mark(owner.attempt.id, { score: 100, outcome: "full", errorType: null }));
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
    await db
      .insert(marks)
      .values(mark(attempt.id, { score: 100, outcome: "full", errorType: null }));

    expect(await getVisibleSolution(user.id, question.id)).toBeNull();
  });
});
