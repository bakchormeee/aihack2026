import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  misconceptionSources,
  misconceptions,
  questions,
  questionTopics,
  revisionSessions,
  sheets,
  solutions,
  submissions,
  topics,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";
import { claimMark, performMark, type MarkIo } from "@/lib/pipeline/mark";
import { buildRevisionSession } from "@/lib/pipeline/revision";
import { buildSpotSession } from "@/lib/pipeline/spot-session";

import {
  binCourse,
  binnedQuestionIdsOf,
  binSheet,
  ownsCourse,
  restoreCourse,
  restoreSheet,
} from "./bin";

/** A student with two sheets; sheet A has a question with a variant. Every question has a stuck attempt. */
async function world(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [topic] = await db.insert(topics).values({ courseId: course.id, name: "T" }).returning();
  const [a, b] = await db
    .insert(sheets)
    .values([
      { courseId: course.id, title: "A", status: "ready" },
      { courseId: course.id, title: "B", status: "ready" },
    ])
    .returning();
  const question = async (sheetId: string | null, parentQuestionId: string | null = null) => {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId,
        position: 1,
        label: "1",
        body: "Q",
        expectedMinutes: 10,
        source: parentQuestionId ? "variant" : "original",
        parentQuestionId,
        hintsStatus: "ready",
      })
      .returning();
    await db.insert(questionTopics).values({ questionId: q.id, topicId: topic.id });
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "S" });
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: q.id, context: "sheet" })
      .returning();
    const [mark] = await db
      .insert(marks)
      .values({
        attemptId: attempt.id,
        basis: "ai",
        score: 0,
        outcome: "stuck",
        feedback: "f",
        overallFeedback: "o",
      })
      .returning();
    return { q, attempt, mark };
  };
  const qa = await question(a.id);
  const va = await question(null, qa.q.id);
  const qb = await question(b.id);
  return { user, course, topic, a, b, qa, va, qb };
}

const sheetRow = async (id: string) => (await db.select().from(sheets).where(eq(sheets.id, id)))[0];
const courseRow = async (id: string) =>
  (await db.select().from(courses).where(eq(courses.id, id)))[0];
const sessionRow = async (id: string) =>
  (await db.select().from(revisionSessions).where(eq(revisionSessions.id, id)))[0];

describe("binning and restoring", () => {
  it("bins and restores the owner's sheet, setting and clearing only its date", async () => {
    const w = await world("bin-sheet@test.local");
    const now = new Date("2026-11-15T10:00:00Z");

    const binned = await binSheet(w.user.id, w.a.id, now);
    expect(binned.deletedAt).toEqual(now);
    expect((await courseRow(w.course.id)).deletedAt).toBeNull();

    await restoreSheet(w.user.id, w.a.id);
    expect(await sheetRow(w.a.id)).toMatchObject({ deletedAt: null, title: "A", status: "ready" });
  });

  it("bins and restores the owner's course", async () => {
    const w = await world("bin-course@test.local");

    await binCourse(w.user.id, w.course.id);
    expect((await courseRow(w.course.id)).deletedAt).toBeInstanceOf(Date);
    // Nothing inside the course is written.
    expect((await sheetRow(w.a.id)).deletedAt).toBeNull();

    await restoreCourse(w.user.id, w.course.id);
    expect((await courseRow(w.course.id)).deletedAt).toBeNull();
  });

  it("refuses another user's course and sheet, for binning and for restoring", async () => {
    const w = await world("bin-owner@test.local");
    const [other] = await db.insert(users).values({ email: "bin-thief@test.local" }).returning();

    await expect(binCourse(other.id, w.course.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(binSheet(other.id, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
    await binCourse(w.user.id, w.course.id);
    await expect(restoreCourse(other.id, w.course.id)).rejects.toBeInstanceOf(NotFoundError);
    await restoreCourse(w.user.id, w.course.id);
    await binSheet(w.user.id, w.a.id);
    await expect(restoreSheet(other.id, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses binning twice, restoring what is not binned, and a missing id", async () => {
    const w = await world("bin-twice@test.local");

    await expect(restoreCourse(w.user.id, w.course.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreSheet(w.user.id, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
    await binSheet(w.user.id, w.a.id);
    await expect(binSheet(w.user.id, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
    await binCourse(w.user.id, w.course.id);
    await expect(binCourse(w.user.id, w.course.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(binCourse(w.user.id, "no-such-id")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses binning a sheet of a binned course, and restoring it on its own", async () => {
    const w = await world("bin-in-course@test.local");
    await binSheet(w.user.id, w.a.id);
    await binCourse(w.user.id, w.course.id);

    await expect(binSheet(w.user.id, w.b.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(restoreSheet(w.user.id, w.a.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("restoring a course leaves a sheet binned earlier on its own in the bin, with its date", async () => {
    const w = await world("bin-earlier@test.local");
    const earlier = new Date("2026-11-01T10:00:00Z");
    await binSheet(w.user.id, w.a.id, earlier);
    await binCourse(w.user.id, w.course.id);

    await restoreCourse(w.user.id, w.course.id);

    expect((await sheetRow(w.a.id)).deletedAt).toEqual(earlier);
    expect((await sheetRow(w.b.id)).deletedAt).toBeNull();
    expect(await binnedQuestionIdsOf(w.course.id)).toEqual(new Set([w.qa.q.id, w.va.q.id]));
  });
});

describe("binnedQuestionIdsOf", () => {
  it("is empty when nothing is binned", async () => {
    const w = await world("bin-ids-none@test.local");
    expect(await binnedQuestionIdsOf(w.course.id)).toEqual(new Set());
  });

  it("holds a binned sheet's questions and their variants", async () => {
    const w = await world("bin-ids@test.local");
    await binSheet(w.user.id, w.a.id);
    expect(await binnedQuestionIdsOf(w.course.id)).toEqual(new Set([w.qa.q.id, w.va.q.id]));
  });
});

describe("ownsCourse", () => {
  it("is true for the owner's course, binned or not, and false for another user", async () => {
    const w = await world("bin-owns@test.local");
    const [other] = await db.insert(users).values({ email: "bin-owns-o@test.local" }).returning();
    await binCourse(w.user.id, w.course.id);

    expect(await ownsCourse(w.user.id, w.course.id)).toBe(true);
    expect(await ownsCourse(other.id, w.course.id)).toBe(false);
  });
});

describe("binning while a job runs", () => {
  it("a mark claimed before its sheet was binned is still saved", async () => {
    const w = await world("bin-job-mark@test.local");
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: w.user.id, questionId: w.qa.q.id, context: "sheet" })
      .returning();
    const [submission] = await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "x", submittedAt: new Date() })
      .returning();
    const claim = await claimMark({ submissionId: submission.id, basis: "ai" });
    await binSheet(w.user.id, w.a.id);

    const io: MarkIo = {
      readFile: async () => Buffer.from(""),
      mark: async () => ({ score: 5, mistakes: [], feedback: "f", overallFeedback: "o" }),
    };
    await performMark(claim!, io);

    const [row] = await db.select().from(submissions).where(eq(submissions.id, submission.id));
    expect(row.markStatus).toBe("done");
    expect(await db.select().from(marks).where(eq(marks.attemptId, attempt.id))).toHaveLength(1);
  });

  it("a revision session being built when its course is binned still becomes ready", async () => {
    const w = await world("bin-job-revision@test.local");
    const [session] = await db
      .insert(revisionSessions)
      .values({ userId: w.user.id, courseId: w.course.id, targetMinutes: 20 })
      .returning();
    await binCourse(w.user.id, w.course.id);

    await buildRevisionSession(session.id, {
      generateVariant: async () => ({
        body: "V",
        solution: "S",
        finalAnswer: "1",
        hints: ["1", "2", "3"],
        expectedMinutes: 5,
      }),
    });

    expect((await sessionRow(session.id)).status).toBe("ready");
  });

  it("a spot-the-error session being built when its course is binned still becomes ready", async () => {
    const w = await world("bin-job-spot@test.local");
    const [m] = await db
      .insert(misconceptions)
      .values({ userId: w.user.id, courseId: w.course.id, description: "D", errorType: "method" })
      .returning();
    await db.insert(misconceptionSources).values({
      misconceptionId: m.id,
      markId: w.qb.mark.id,
      mistakeIndex: 0,
      attemptId: w.qb.attempt.id,
      topicIds: [w.topic.id],
      quote: "q",
    });
    const [session] = await db
      .insert(revisionSessions)
      .values({ userId: w.user.id, courseId: w.course.id, mode: "spot_error", questionCount: 1 })
      .returning();
    await binCourse(w.user.id, w.course.id);

    await buildSpotSession(
      session.id,
      {
        write: async (input) => ({
          body: "B",
          lines: ["1", "2", "3"],
          planted: input.plant.map((p) => ({
            line: 2,
            misconception: p.id,
            whatsWrong: "w",
            correctLine: "c",
          })),
          expectedMinutes: 3,
        }),
      },
      () => 0.5,
    );

    expect((await sessionRow(session.id)).status).toBe("ready");
  });
});
