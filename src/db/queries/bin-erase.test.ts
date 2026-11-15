import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  misconceptionSources,
  misconceptions,
  questions,
  revisionItems,
  revisionSessions,
  sheetFiles,
  sheets,
  solutions,
  spotAnswers,
  spotItems,
  submissionFiles,
  submissions,
  topics,
  users,
} from "@/db/schema";
import { BIN_DAYS } from "@/lib/bin/rules";

import { eraseDueBinItems, logEraseFailure, type EraseIo } from "./bin-erase";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function fakeIo(fail: string[] = []) {
  const deleted: string[] = [];
  const io: EraseIo = {
    deleteObject: vi.fn(async (key: string) => {
      if (fail.includes(key)) throw new Error("R2 is down");
      deleted.push(key);
    }),
  };
  return { io, deleted };
}

/**
 * A student with sheet A (question qa with a variant and a variant of that) and sheet B
 * (question qb). Every question has an attempt with a hint reveal, a submission with a
 * photo and a mark. `filesFrom` is the folder of the sheet PDFs (another user's for a
 * demo copy). The photo of qa is also used by a retry copy of qb's submission.
 */
async function world(email: string, o: { filesFrom?: string } = {}) {
  const [user] = await db.insert(users).values({ email }).returning();
  const own = `u/${user.id}`;
  const files = o.filesFrom ?? own;
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [topic] = await db.insert(topics).values({ courseId: course.id, name: "T" }).returning();
  const [a, b] = await db
    .insert(sheets)
    .values([
      { courseId: course.id, title: "A", status: "ready" },
      { courseId: course.id, title: "B", status: "ready" },
    ])
    .returning();
  await db.insert(sheetFiles).values([
    { sheetId: a.id, kind: "sheet", path: `${files}/sheet/${a.id}/a.pdf`, mime: "application/pdf" },
    { sheetId: b.id, kind: "sheet", path: `${files}/sheet/${b.id}/b.pdf`, mime: "application/pdf" },
  ]);
  const [session] = await db
    .insert(revisionSessions)
    .values({ userId: user.id, courseId: course.id, targetMinutes: 20, status: "ready" })
    .returning();
  const [misconception] = await db
    .insert(misconceptions)
    .values({ userId: user.id, courseId: course.id, description: "D", errorType: "method" })
    .returning();

  const question = async (sheetId: string | null, parentQuestionId: string | null) => {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId,
        position: 1,
        label: "1",
        body: "Q",
        expectedMinutes: 5,
        source: parentQuestionId ? "variant" : "original",
        parentQuestionId,
      })
      .returning();
    const [hint] = await db
      .insert(hints)
      .values({ questionId: q.id, level: 1, body: "h" })
      .returning();
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "s" });
    const [attempt] = await db
      .insert(attempts)
      .values({
        userId: user.id,
        questionId: q.id,
        context: parentQuestionId ? "revision" : "sheet",
        revisionSessionId: parentQuestionId ? session.id : null,
      })
      .returning();
    await db.insert(hintReveals).values({ attemptId: attempt.id, hintId: hint.id });
    const [submission] = await db
      .insert(submissions)
      .values({ attemptId: attempt.id, submittedAt: NOW })
      .returning();
    const photo = `${own}/working/${attempt.id}/p.jpg`;
    await db
      .insert(submissionFiles)
      .values({ submissionId: submission.id, path: photo, mime: "image/jpeg" });
    const [mark] = await db
      .insert(marks)
      .values({
        attemptId: attempt.id,
        basis: "ai",
        score: 2,
        outcome: "partial",
        feedback: "f",
        overallFeedback: "o",
      })
      .returning();
    await db.insert(misconceptionSources).values({
      misconceptionId: misconception.id,
      markId: mark.id,
      mistakeIndex: 0,
      attemptId: attempt.id,
      topicIds: [topic.id],
      quote: "q",
    });
    return { q, attempt, submission, photo };
  };

  const qa = await question(a.id, null);
  const va = await question(null, qa.q.id);
  const vva = await question(null, va.q.id);
  const qb = await question(b.id, null);
  await db.insert(revisionItems).values([
    { sessionId: session.id, questionId: va.q.id, position: 1, source: "variant", reason: "r" },
    { sessionId: session.id, questionId: qb.q.id, position: 2, source: "retry", reason: "r" },
  ]);
  // A retry copy: qb's submission also uses qa's photo.
  await db
    .insert(submissionFiles)
    .values({ submissionId: qb.submission.id, path: qa.photo, mime: "image/jpeg", position: 1 });
  // A spot-the-error answer belongs to no sheet.
  const [spotSession] = await db
    .insert(revisionSessions)
    .values({
      userId: user.id,
      courseId: course.id,
      mode: "spot_error",
      questionCount: 1,
      status: "ready",
    })
    .returning();
  const [spot] = await db
    .insert(spotItems)
    .values({
      sessionId: spotSession.id,
      position: 1,
      body: "B",
      lines: ["1"],
      planted: [],
      topicIds: [topic.id],
    })
    .returning();
  await db.insert(spotAnswers).values({ itemId: spot.id, userId: user.id, outcome: "full" });

  return { user, course, a, b, session, misconception, qa, va, vva, qb, spot };
}

const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id);
const questionIds = (courseId: string) =>
  ids(db.select().from(questions).where(eq(questions.courseId, courseId)));

describe("eraseDueBinItems: a sheet", () => {
  it("erases a sheet binned 30 days ago with its questions, variants and history", async () => {
    const w = await world("er-sheet@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(BIN_DAYS) })
      .where(eq(sheets.id, w.a.id));
    const { io, deleted } = fakeIo();

    expect(await eraseDueBinItems(w.user.id, NOW, io)).toEqual({ courses: [], sheets: [w.a.id] });

    expect(await ids(db.select().from(sheets).where(eq(sheets.courseId, w.course.id)))).toEqual([
      w.b.id,
    ]);
    expect(await questionIds(w.course.id)).toEqual([w.qb.q.id]);
    const gone = [w.qa, w.va, w.vva].map((x) => x.attempt.id);
    expect(await db.select().from(attempts).where(inArray(attempts.id, gone))).toEqual([]);
    expect(await db.select().from(marks).where(inArray(marks.attemptId, gone))).toEqual([]);
    expect(await db.select().from(hintReveals).where(inArray(hintReveals.attemptId, gone))).toEqual(
      [],
    );
    expect(await db.select().from(submissions).where(inArray(submissions.attemptId, gone))).toEqual(
      [],
    );
    expect(
      await db
        .select()
        .from(misconceptionSources)
        .where(eq(misconceptionSources.misconceptionId, w.misconception.id)),
    ).toHaveLength(1);
    // The revision session stays, with only the item on the kept question.
    expect(
      (await db.select().from(revisionItems).where(eq(revisionItems.sessionId, w.session.id))).map(
        (i) => i.questionId,
      ),
    ).toEqual([w.qb.q.id]);
    // The kept question still has its history; the spot answer stays.
    expect(await db.select().from(attempts).where(eq(attempts.id, w.qb.attempt.id))).toHaveLength(
      1,
    );
    expect(
      await db.select().from(spotAnswers).where(eq(spotAnswers.itemId, w.spot.id)),
    ).toHaveLength(1);

    // Files: the sheet PDF and the photos only erased rows used; qa's photo is still used by qb.
    expect(deleted.sort()).toEqual(
      [`u/${w.user.id}/sheet/${w.a.id}/a.pdf`, w.va.photo, w.vva.photo].sort(),
    );
  });

  it("touches nothing younger than 30 days", async () => {
    const w = await world("er-young@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: new Date(daysAgo(BIN_DAYS).getTime() + 1000) })
      .where(eq(sheets.id, w.a.id));
    const { io } = fakeIo();

    expect(await eraseDueBinItems(w.user.id, NOW, io)).toEqual({ courses: [], sheets: [] });
    expect(await questionIds(w.course.id)).toHaveLength(4);
    expect(io.deleteObject).not.toHaveBeenCalled();
  });

  it("is harmless to run twice", async () => {
    const w = await world("er-twice@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(40) })
      .where(eq(sheets.id, w.a.id));
    await eraseDueBinItems(w.user.id, NOW, fakeIo().io);
    const second = fakeIo();

    expect(await eraseDueBinItems(w.user.id, NOW, second.io)).toEqual({ courses: [], sheets: [] });
    expect(second.io.deleteObject).not.toHaveBeenCalled();
    expect(await questionIds(w.course.id)).toEqual([w.qb.q.id]);
  });

  it("still erases the rows when a file cannot be deleted, and logs it", async () => {
    const w = await world("er-fail@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(31) })
      .where(eq(sheets.id, w.a.id));
    const { io, deleted } = fakeIo([w.va.photo]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await eraseDueBinItems(w.user.id, NOW, io);

    expect(await questionIds(w.course.id)).toEqual([w.qb.q.id]);
    expect(deleted).toContain(w.vva.photo);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(w.va.photo), expect.any(Error));
    log.mockRestore();
  });

  it("erases only the user's own items", async () => {
    const mine = await world("er-mine@test.local");
    const theirs = await world("er-theirs@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(40) })
      .where(eq(sheets.id, theirs.a.id));

    expect(await eraseDueBinItems(mine.user.id, NOW, fakeIo().io)).toEqual({
      courses: [],
      sheets: [],
    });
    expect(await questionIds(theirs.course.id)).toHaveLength(4);
  });
});

describe("eraseDueBinItems: a course", () => {
  it("erases a course binned 30 days ago with everything in it, and all its own files", async () => {
    const w = await world("er-course@test.local");
    // Sheet A was binned on its own a little earlier; it goes with the course.
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(BIN_DAYS + 2) })
      .where(eq(sheets.id, w.a.id));
    await db
      .update(courses)
      .set({ deletedAt: daysAgo(BIN_DAYS) })
      .where(eq(courses.id, w.course.id));
    const { io, deleted } = fakeIo();

    expect(await eraseDueBinItems(w.user.id, NOW, io)).toEqual({
      courses: [w.course.id],
      sheets: [],
    });

    expect(await db.select().from(courses).where(eq(courses.id, w.course.id))).toEqual([]);
    expect(await questionIds(w.course.id)).toEqual([]);
    expect(await db.select().from(attempts).where(eq(attempts.userId, w.user.id))).toEqual([]);
    expect(
      await db.select().from(revisionSessions).where(eq(revisionSessions.userId, w.user.id)),
    ).toEqual([]);
    expect(
      await db.select().from(misconceptions).where(eq(misconceptions.userId, w.user.id)),
    ).toEqual([]);
    expect(deleted.sort()).toEqual(
      [
        `u/${w.user.id}/sheet/${w.a.id}/a.pdf`,
        `u/${w.user.id}/sheet/${w.b.id}/b.pdf`,
        w.qa.photo,
        w.va.photo,
        w.vva.photo,
        w.qb.photo,
      ].sort(),
    );
    // The user stays.
    expect(await db.select().from(users).where(eq(users.id, w.user.id))).toHaveLength(1);
  });

  it("erases a sheet binned on its own when its own 30 days are up, while its course is younger in the bin", async () => {
    const w = await world("er-course-young@test.local");
    await db
      .update(sheets)
      .set({ deletedAt: daysAgo(BIN_DAYS) })
      .where(eq(sheets.id, w.a.id));
    await db
      .update(courses)
      .set({ deletedAt: daysAgo(3) })
      .where(eq(courses.id, w.course.id));

    expect(await eraseDueBinItems(w.user.id, NOW, fakeIo().io)).toEqual({
      courses: [],
      sheets: [w.a.id],
    });
    expect(await db.select().from(courses).where(eq(courses.id, w.course.id))).toHaveLength(1);
    expect(await questionIds(w.course.id)).toEqual([w.qb.q.id]);
  });
});

describe("eraseDueBinItems: a demo copy", () => {
  it("never deletes the demo template's sheet files, only the copy's own photos", async () => {
    const [template] = await db
      .insert(users)
      .values({ email: "er-template@demo.invalid", demoRole: "template" })
      .returning();
    const w = await world("er-copy@test.local", { filesFrom: `u/${template.id}` });
    await db.update(users).set({ demoRole: "copy" }).where(eq(users.id, w.user.id));
    await db
      .update(courses)
      .set({ deletedAt: daysAgo(BIN_DAYS) })
      .where(eq(courses.id, w.course.id));
    const { io, deleted } = fakeIo();

    await eraseDueBinItems(w.user.id, NOW, io);

    expect(deleted.every((key) => key.startsWith(`u/${w.user.id}/`))).toBe(true);
    expect(deleted).not.toContain(`u/${template.id}/sheet/${w.a.id}/a.pdf`);
    expect(deleted).toHaveLength(4);
  });
});

describe("logEraseFailure", () => {
  it("logs the error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    logEraseFailure(error);
    expect(log).toHaveBeenCalledWith("Bin erase failed", error);
    log.mockRestore();
  });
});
