import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { attempts, courses, marks, questions, sheets, submissions, users } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import { getMarkScreenData } from "./marking";

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
