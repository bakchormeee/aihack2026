import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { binSheet, restoreSheet } from "@/db/queries/bin";
import {
  findUnreadMarks,
  getCourseMisconceptionState,
  listMisconceptions,
} from "@/db/queries/misconceptions";
import {
  attempts,
  courses,
  marks,
  misconceptionJobs,
  misconceptionMarks,
  misconceptionSources,
  misconceptions,
  questions,
  sheets,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";
import { STALE_JOB_MS } from "@/lib/domain";

async function world(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [q] = await db
    .insert(questions)
    .values({ courseId: course.id, position: 1, label: "1", body: "B", expectedMinutes: 5 })
    .returning();
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: q.id, context: "sheet" })
    .returning();
  const [mark] = await db
    .insert(marks)
    .values({
      attemptId: attempt.id,
      basis: "ai",
      score: 3,
      outcome: "partial",
      mistakes: [],
      feedback: "f",
      overallFeedback: "o",
    })
    .returning();
  return { user, course, attempt, mark };
}
const setJob = (
  w: { user: { id: string }; course: { id: string } },
  status: "building" | "ready" | "failed",
  ageMs = 0,
) =>
  db
    .insert(misconceptionJobs)
    .values({
      userId: w.user.id,
      courseId: w.course.id,
      status,
      statusUpdatedAt: new Date(Date.now() - ageMs),
    })
    .onConflictDoUpdate({
      target: [misconceptionJobs.userId, misconceptionJobs.courseId],
      set: { status, statusUpdatedAt: new Date(Date.now() - ageMs) },
    });

describe("getCourseMisconceptionState", () => {
  it("asks for a refresh when a mark has not been read and no job runs", async () => {
    const w = await world("st-unread@test.local");

    expect(await getCourseMisconceptionState(w.user.id, w.course.id)).toMatchObject({
      shouldStart: true,
      updating: true,
      visible: [],
    });
  });

  it("is quiet when every mark has been read", async () => {
    const w = await world("st-read@test.local");
    await db
      .insert(misconceptionMarks)
      .values({ markId: w.mark.id, userId: w.user.id, courseId: w.course.id });

    expect(await getCourseMisconceptionState(w.user.id, w.course.id)).toMatchObject({
      shouldStart: false,
      updating: false,
    });
  });

  it("says it is updating but does not start another run while a job is running", async () => {
    const w = await world("st-running@test.local");
    await setJob(w, "building");

    expect(await getCourseMisconceptionState(w.user.id, w.course.id)).toMatchObject({
      shouldStart: false,
      updating: true,
    });
  });

  it("starts again over a stale running job", async () => {
    const w = await world("st-stale@test.local");
    await setJob(w, "building", STALE_JOB_MS + 1000);

    expect((await getCourseMisconceptionState(w.user.id, w.course.id)).shouldStart).toBe(true);
  });

  it("waits a couple of minutes after a failed run before trying again", async () => {
    const w = await world("st-failed@test.local");
    await setJob(w, "failed", 10_000);
    expect(await getCourseMisconceptionState(w.user.id, w.course.id)).toMatchObject({
      shouldStart: false,
      updating: false,
    });

    await setJob(w, "failed", 3 * 60_000);
    expect((await getCourseMisconceptionState(w.user.id, w.course.id)).shouldStart).toBe(true);
  });

  it("lists only visible misconceptions that currently count", async () => {
    const w = await world("st-visible@test.local");
    await db
      .insert(misconceptionMarks)
      .values({ markId: w.mark.id, userId: w.user.id, courseId: w.course.id });
    const [shown, hidden, unused] = await db
      .insert(misconceptions)
      .values([
        { userId: w.user.id, courseId: w.course.id, description: "Shown", errorType: "method" },
        {
          userId: w.user.id,
          courseId: w.course.id,
          description: "Hidden",
          errorType: "method",
          hiddenAt: new Date(),
        },
        { userId: w.user.id, courseId: w.course.id, description: "Unused", errorType: "method" },
      ])
      .returning();
    await db.insert(misconceptionSources).values(
      [shown, hidden].map((m, i) => ({
        misconceptionId: m.id,
        markId: w.mark.id,
        mistakeIndex: i,
        attemptId: w.attempt.id,
        topicIds: [],
        quote: "q",
      })),
    );
    expect(unused.id).toBeTruthy();

    const state = await getCourseMisconceptionState(w.user.id, w.course.id);

    expect(state.visible.map((m) => m.description)).toEqual(["Shown"]);
  });

  it("refuses another student's course", async () => {
    const a = await world("st-a@test.local");
    const b = await world("st-b@test.local");

    await expect(getCourseMisconceptionState(b.user.id, a.course.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("common errors and the bin", () => {
  it("does not count a mistake from a binned sheet, and counts it again after restore", async () => {
    const w = await world("st-bin@test.local");
    const [sheet] = await db
      .insert(sheets)
      .values({ courseId: w.course.id, title: "S", status: "ready" })
      .returning();
    const [q] = await db
      .insert(questions)
      .values({
        courseId: w.course.id,
        sheetId: sheet.id,
        position: 1,
        label: "S1",
        body: "B",
        expectedMinutes: 5,
      })
      .returning();
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: w.user.id, questionId: q.id, context: "sheet" })
      .returning();
    const [mark] = await db
      .insert(marks)
      .values({
        attemptId: attempt.id,
        basis: "ai",
        score: 2,
        outcome: "partial",
        mistakes: [],
        feedback: "f",
        overallFeedback: "o",
      })
      .returning();
    const [both, onlyBinned] = await db
      .insert(misconceptions)
      .values([
        { userId: w.user.id, courseId: w.course.id, description: "Both", errorType: "method" },
        { userId: w.user.id, courseId: w.course.id, description: "Binned", errorType: "method" },
      ])
      .returning();
    const source = (misconceptionId: string, m: { id: string }, a: { id: string }, i: number) => ({
      misconceptionId,
      markId: m.id,
      mistakeIndex: i,
      attemptId: a.id,
      topicIds: [],
      quote: "q",
    });
    await db
      .insert(misconceptionSources)
      .values([
        source(both.id, w.mark, w.attempt, 0),
        source(both.id, mark, attempt, 0),
        source(onlyBinned.id, mark, attempt, 1),
      ]);

    const seen = async () =>
      Object.fromEntries(
        (await listMisconceptions(w.user.id, w.course.id)).map((m) => [m.description, m.timesSeen]),
      );
    const unread = async () =>
      (await findUnreadMarks(w.user.id, w.course.id)).map((u) => u.attemptId).sort();

    expect(await seen()).toEqual({ Both: 2, Binned: 1 });
    expect(await unread()).toEqual([w.attempt.id, attempt.id].sort());

    await binSheet(w.user.id, sheet.id);
    expect(await seen()).toEqual({ Both: 1 });
    expect(await unread()).toEqual([w.attempt.id]);

    await restoreSheet(w.user.id, sheet.id);
    expect(await seen()).toEqual({ Both: 2, Binned: 1 });
    expect(await unread()).toEqual([w.attempt.id, attempt.id].sort());
  });
});
