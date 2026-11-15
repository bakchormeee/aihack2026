import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import * as s from "@/db/schema";
import { expiryOf } from "@/lib/demo/rules";

import {
  DEMO_TEMPLATE_EMAIL,
  DemoUnavailableError,
  createDemoCopy,
  eraseDemoCopy,
  eraseDemoUser,
  eraseExpiredDemoCopies,
  findLiveDemoCopy,
} from "./demo";

vi.setConfig({ testTimeout: 60_000 });

const DAY = 24 * 60 * 60 * 1000;
const NEWEST = new Date("2026-11-01T18:00:00Z");
const ago = (days: number) => new Date(NEWEST.getTime() - days * DAY);
const NOW = new Date("2026-11-15T12:00:00Z");
const SHIFT = NOW.getTime() - NEWEST.getTime();

/** A small template with a row in every table a copy holds. */
async function makeTemplate() {
  const [t] = await db
    .insert(s.users)
    .values({ email: DEMO_TEMPLATE_EMAIL, name: "Demo student", demoRole: "template" })
    .returning();
  const u = t.id;
  const [course] = await db
    .insert(s.courses)
    .values({ userId: u, name: "Numbers", createdAt: ago(21) })
    .returning();
  const [parent, child] = await db
    .insert(s.topics)
    .values([
      { courseId: course.id, name: "Inequalities" },
      { courseId: course.id, name: "Rearranging" },
    ])
    .returning();
  await db.update(s.topics).set({ parentId: parent.id }).where(eq(s.topics.id, child.id));
  await db.insert(s.topicPrereqs).values({ topicId: child.id, prereqId: parent.id });
  const [sheet] = await db
    .insert(s.sheets)
    .values({
      courseId: course.id,
      title: "Sheet 1",
      status: "ready",
      uploadedAt: ago(21),
      solutionsStatus: "done",
    })
    .returning();
  await db
    .insert(s.sheetFiles)
    .values({
      sheetId: sheet.id,
      kind: "sheet",
      path: `u/${u}/sheet/${sheet.id}/a.pdf`,
      mime: "application/pdf",
    });
  const [q] = await db
    .insert(s.questions)
    .values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "Solve $x>1$",
      expectedMinutes: 10,
      hintsStatus: "ready",
    })
    .returning();
  const [variant] = await db
    .insert(s.questions)
    .values({
      courseId: course.id,
      sheetId: null,
      position: 1,
      label: "1'",
      body: "Solve $x>2$",
      expectedMinutes: 10,
      source: "variant",
      parentQuestionId: q.id,
    })
    .returning();
  await db.insert(s.questionTopics).values([
    { questionId: q.id, topicId: child.id },
    { questionId: variant.id, topicId: child.id },
  ]);
  const [hint] = await db
    .insert(s.hints)
    .values({ questionId: q.id, level: 1, body: "Think" })
    .returning();
  await db.insert(s.solutions).values({ questionId: q.id, basis: "ai", body: "Worked" });

  const [session] = await db
    .insert(s.revisionSessions)
    .values({
      userId: u,
      courseId: course.id,
      targetMinutes: 30,
      topicIds: [child.id],
      status: "ready",
      createdAt: ago(2),
    })
    .returning();
  await db
    .insert(s.revisionItems)
    .values({
      sessionId: session.id,
      questionId: variant.id,
      position: 1,
      source: "variant",
      reason: "r",
    });

  const [attempt] = await db
    .insert(s.attempts)
    .values({
      userId: u,
      questionId: q.id,
      context: "sheet",
      startedAt: ago(10),
      secondsSpent: 300,
    })
    .returning();
  const [revAttempt] = await db
    .insert(s.attempts)
    .values({
      userId: u,
      questionId: variant.id,
      context: "revision",
      revisionSessionId: session.id,
      startedAt: ago(2),
    })
    .returning();
  await db
    .insert(s.hintReveals)
    .values({ attemptId: attempt.id, hintId: hint.id, revealedAt: ago(10) });
  const [sub] = await db
    .insert(s.submissions)
    .values({ attemptId: attempt.id, text: "x > 1", submittedAt: ago(10), markStatus: "done" })
    .returning();
  await db
    .insert(s.submissionFiles)
    .values({ submissionId: sub.id, path: `u/${u}/working/${sub.id}/w.png`, mime: "image/png" });
  const [mark] = await db
    .insert(s.marks)
    .values({
      attemptId: attempt.id,
      basis: "ai",
      score: 2,
      outcome: "partial",
      feedback: "f",
      overallFeedback: "o",
      createdAt: ago(10),
    })
    .returning();
  await db.insert(s.marks).values({
    attemptId: attempt.id,
    basis: "ai",
    score: 4,
    outcome: "full",
    feedback: "f",
    overallFeedback: "o",
    isDispute: true,
    disputeReason: "I did check",
    createdAt: NEWEST,
  });
  await db
    .insert(s.sheetSummaries)
    .values({
      sheetId: sheet.id,
      bodyJson: { wentWell: ["a"], wasHard: [], nextSteps: [] },
      generatedAt: ago(1),
    });
  const [mc] = await db
    .insert(s.misconceptions)
    .values({
      userId: u,
      courseId: course.id,
      description: "Sign flips",
      errorType: "conceptual",
      createdAt: ago(5),
    })
    .returning();
  await db
    .insert(s.misconceptionSources)
    .values({
      misconceptionId: mc.id,
      markId: mark.id,
      mistakeIndex: 0,
      attemptId: attempt.id,
      topicIds: [child.id],
      quote: "x>1",
    });
  await db.insert(s.misconceptionMarks).values({ markId: mark.id, userId: u, courseId: course.id });
  await db.insert(s.misconceptionJobs).values({ userId: u, courseId: course.id, status: "ready" });

  const [spot] = await db
    .insert(s.revisionSessions)
    .values({
      userId: u,
      courseId: course.id,
      mode: "spot_error",
      questionCount: 5,
      status: "ready",
      createdAt: ago(1),
    })
    .returning();
  const [item] = await db
    .insert(s.spotItems)
    .values({
      sessionId: spot.id,
      position: 1,
      body: "Q",
      lines: ["a", "b"],
      planted: [{ line: 2, misconceptionId: mc.id, whatsWrong: "w", correctLine: "c" }],
      topicIds: [child.id],
    })
    .returning();
  await db.insert(s.spotAnswers).values({
    itemId: item.id,
    userId: u,
    startedAt: ago(1),
    answeredAt: ago(1),
    outcome: "full",
    ticked: [{ line: 2, explanation: "flip" }],
  });
  return {
    u,
    course,
    child,
    parent,
    q,
    variant,
    attempt,
    revAttempt,
    mark,
    mc,
    session,
    spot,
    item,
    sheet,
  };
}

/** Rows each table holds for one user (through its courses and attempts). */
async function countRows(userId: string) {
  const courseIds = (
    await db.select({ id: s.courses.id }).from(s.courses).where(eq(s.courses.userId, userId))
  ).map((r) => r.id);
  const attemptIds = (
    await db.select({ id: s.attempts.id }).from(s.attempts).where(eq(s.attempts.userId, userId))
  ).map((r) => r.id);
  const sessionIds = (
    await db
      .select({ id: s.revisionSessions.id })
      .from(s.revisionSessions)
      .where(eq(s.revisionSessions.userId, userId))
  ).map((r) => r.id);
  const q = async (rows: Promise<unknown[]>) => (await rows).length;
  const any = (ids: string[]) => (ids.length ? ids : ["-"]);
  const questionIds = (
    await db
      .select({ id: s.questions.id })
      .from(s.questions)
      .where(inArray(s.questions.courseId, any(courseIds)))
  ).map((r) => r.id);
  const sheetIds = (
    await db
      .select({ id: s.sheets.id })
      .from(s.sheets)
      .where(inArray(s.sheets.courseId, any(courseIds)))
  ).map((r) => r.id);
  const topicIds = (
    await db
      .select({ id: s.topics.id })
      .from(s.topics)
      .where(inArray(s.topics.courseId, any(courseIds)))
  ).map((r) => r.id);
  const submissionIds = (
    await db
      .select({ id: s.submissions.id })
      .from(s.submissions)
      .where(inArray(s.submissions.attemptId, any(attemptIds)))
  ).map((r) => r.id);
  const itemIds = (
    await db
      .select({ id: s.spotItems.id })
      .from(s.spotItems)
      .where(inArray(s.spotItems.sessionId, any(sessionIds)))
  ).map((r) => r.id);
  const misconceptionIds = (
    await db
      .select({ id: s.misconceptions.id })
      .from(s.misconceptions)
      .where(eq(s.misconceptions.userId, userId))
  ).map((r) => r.id);
  return {
    courses: courseIds.length,
    topics: topicIds.length,
    topicPrereqs: await q(
      db
        .select()
        .from(s.topicPrereqs)
        .where(inArray(s.topicPrereqs.topicId, any(topicIds))),
    ),
    sheets: sheetIds.length,
    sheetFiles: await q(
      db
        .select()
        .from(s.sheetFiles)
        .where(inArray(s.sheetFiles.sheetId, any(sheetIds))),
    ),
    questions: questionIds.length,
    questionTopics: await q(
      db
        .select()
        .from(s.questionTopics)
        .where(inArray(s.questionTopics.questionId, any(questionIds))),
    ),
    hints: await q(
      db
        .select()
        .from(s.hints)
        .where(inArray(s.hints.questionId, any(questionIds))),
    ),
    solutions: await q(
      db
        .select()
        .from(s.solutions)
        .where(inArray(s.solutions.questionId, any(questionIds))),
    ),
    revisionSessions: sessionIds.length,
    revisionItems: await q(
      db
        .select()
        .from(s.revisionItems)
        .where(inArray(s.revisionItems.sessionId, any(sessionIds))),
    ),
    attempts: attemptIds.length,
    hintReveals: await q(
      db
        .select()
        .from(s.hintReveals)
        .where(inArray(s.hintReveals.attemptId, any(attemptIds))),
    ),
    submissions: submissionIds.length,
    submissionFiles: await q(
      db
        .select()
        .from(s.submissionFiles)
        .where(inArray(s.submissionFiles.submissionId, any(submissionIds))),
    ),
    marks: await q(
      db
        .select()
        .from(s.marks)
        .where(inArray(s.marks.attemptId, any(attemptIds))),
    ),
    sheetSummaries: await q(
      db
        .select()
        .from(s.sheetSummaries)
        .where(inArray(s.sheetSummaries.sheetId, any(sheetIds))),
    ),
    misconceptions: misconceptionIds.length,
    misconceptionSources: await q(
      db
        .select()
        .from(s.misconceptionSources)
        .where(inArray(s.misconceptionSources.misconceptionId, any(misconceptionIds))),
    ),
    misconceptionMarks: await q(
      db.select().from(s.misconceptionMarks).where(eq(s.misconceptionMarks.userId, userId)),
    ),
    misconceptionJobs: await q(
      db.select().from(s.misconceptionJobs).where(eq(s.misconceptionJobs.userId, userId)),
    ),
    spotItems: itemIds.length,
    spotAnswers: await q(db.select().from(s.spotAnswers).where(eq(s.spotAnswers.userId, userId))),
  };
}

const noFiles = { deleteObject: async () => {} };

// One template for the whole file: each test makes its own copies.
const template = await makeTemplate();
const templateCounts = await countRows(template.u);

describe("createDemoCopy", () => {
  it("copies every row of the template to a new copy user", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    expect(copy.demoRole).toBe("copy");
    expect(copy.email).toBeNull();
    expect(copy.demoExpiresAt).toEqual(expiryOf(NOW));
    expect(copy.demoAiCalls).toBe(0);

    const counts = await countRows(copy.id);
    expect(Object.values(templateCounts).every((n) => n > 0)).toBe(true);
    expect(counts).toEqual(templateCounts);
  });

  it("gives every row a new id and keeps the links inside the copy", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    const [course] = await db.select().from(s.courses).where(eq(s.courses.userId, copy.id));
    expect(course.id).not.toBe(template.course.id);

    const topics = await db.select().from(s.topics).where(eq(s.topics.courseId, course.id));
    const child = topics.find((t) => t.name === "Rearranging")!;
    const parent = topics.find((t) => t.name === "Inequalities")!;
    expect(child.parentId).toBe(parent.id);

    const qs = await db.select().from(s.questions).where(eq(s.questions.courseId, course.id));
    const original = qs.find((x) => x.source === "original")!;
    const variant = qs.find((x) => x.source === "variant")!;
    expect(variant.parentQuestionId).toBe(original.id);

    const sessions = await db
      .select()
      .from(s.revisionSessions)
      .where(eq(s.revisionSessions.userId, copy.id));
    const longForm = sessions.find((x) => x.mode === "long_form")!;
    expect(longForm.topicIds).toEqual([child.id]);
    const attempts = await db.select().from(s.attempts).where(eq(s.attempts.userId, copy.id));
    expect(attempts.find((a) => a.context === "revision")!.revisionSessionId).toBe(longForm.id);

    const [source] = await db
      .select()
      .from(s.misconceptionSources)
      .innerJoin(s.misconceptions, eq(s.misconceptions.id, s.misconceptionSources.misconceptionId))
      .where(eq(s.misconceptions.userId, copy.id));
    const markIds = (
      await db
        .select({ id: s.marks.id })
        .from(s.marks)
        .where(
          inArray(
            s.marks.attemptId,
            attempts.map((a) => a.id),
          ),
        )
    ).map((m) => m.id);
    expect(markIds).toContain(source.misconception_source.markId);
    expect(source.misconception_source.topicIds).toEqual([child.id]);

    const spot = sessions.find((x) => x.mode === "spot_error")!;
    const [item] = await db.select().from(s.spotItems).where(eq(s.spotItems.sessionId, spot.id));
    expect(item.planted[0].misconceptionId).toBe(source.misconception.id);
    expect(item.topicIds).toEqual([child.id]);
  });

  it("shifts every time so the newest activity is now, and keeps file paths", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    const attempts = await db.select().from(s.attempts).where(eq(s.attempts.userId, copy.id));
    const marks = await db
      .select()
      .from(s.marks)
      .where(
        inArray(
          s.marks.attemptId,
          attempts.map((a) => a.id),
        ),
      );
    expect(Math.max(...marks.map((m) => m.createdAt.getTime()))).toBe(NOW.getTime());
    const sheetAttempt = attempts.find((a) => a.context === "sheet")!;
    expect(sheetAttempt.startedAt.getTime()).toBe(template.attempt.startedAt.getTime() + SHIFT);

    const [course] = await db.select().from(s.courses).where(eq(s.courses.userId, copy.id));
    const [sheet] = await db.select().from(s.sheets).where(eq(s.sheets.courseId, course.id));
    const [file] = await db.select().from(s.sheetFiles).where(eq(s.sheetFiles.sheetId, sheet.id));
    expect(file.path).toBe(`u/${template.u}/sheet/${template.sheet.id}/a.pdf`);
  });

  it("makes independent copies and leaves the template unchanged", async () => {
    const a = await createDemoCopy(NOW, noFiles);
    const b = await createDemoCopy(NOW, noFiles);
    await db
      .update(s.misconceptions)
      .set({ hiddenAt: NOW })
      .where(eq(s.misconceptions.userId, a.id));

    const [inB] = await db.select().from(s.misconceptions).where(eq(s.misconceptions.userId, b.id));
    expect(inB.hiddenAt).toBeNull();
    expect(await countRows(template.u)).toEqual(templateCounts);
    const [tmc] = await db
      .select()
      .from(s.misconceptions)
      .where(eq(s.misconceptions.userId, template.u));
    expect(tmc.hiddenAt).toBeNull();
  });
});

describe("findLiveDemoCopy", () => {
  it("finds a live copy, and not an expired copy, the template or a real user", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    const [real] = await db.insert(s.users).values({ email: "real@test.local" }).returning();
    expect((await findLiveDemoCopy(copy.id, NOW))?.id).toBe(copy.id);
    expect(await findLiveDemoCopy(copy.id, expiryOf(NOW))).toBeNull();
    expect(await findLiveDemoCopy(template.u, NOW)).toBeNull();
    expect(await findLiveDemoCopy(real.id, NOW)).toBeNull();
  });
});

describe("eraseDemoCopy", () => {
  it("removes every row of the copy and only the files under its own folder", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    // A judge uploads working to the copy.
    const [attempt] = await db
      .select()
      .from(s.attempts)
      .where(and(eq(s.attempts.userId, copy.id), eq(s.attempts.context, "sheet")));
    const [sub] = await db
      .select()
      .from(s.submissions)
      .where(eq(s.submissions.attemptId, attempt.id));
    const own = `u/${copy.id}/working/${sub.id}/mine.png`;
    await db
      .insert(s.submissionFiles)
      .values({ submissionId: sub.id, path: own, mime: "image/png" });

    const deleted: string[] = [];
    await eraseDemoCopy(copy.id, { deleteObject: async (k) => void deleted.push(k) });

    expect(deleted).toEqual([own]);
    expect(Object.values(await countRows(copy.id)).every((n) => n === 0)).toBe(true);
    expect(await db.select().from(s.users).where(eq(s.users.id, copy.id))).toHaveLength(0);
    expect(await countRows(template.u)).toEqual(templateCounts);
  });

  it("refuses to erase the template or a real user", async () => {
    const [real] = await db.insert(s.users).values({ email: "real2@test.local" }).returning();
    await expect(eraseDemoCopy(template.u, noFiles)).rejects.toThrow();
    await expect(eraseDemoCopy(real.id, noFiles)).rejects.toThrow();
    expect(await db.select().from(s.users).where(eq(s.users.id, real.id))).toHaveLength(1);
  });

  it("still erases the rows when a file cannot be deleted", async () => {
    const copy = await createDemoCopy(NOW, noFiles);
    const [sheetFile] = await db.select().from(s.sheetFiles).limit(1);
    await db
      .insert(s.sheetFiles)
      .values({
        sheetId: sheetFile.sheetId,
        kind: "sheet",
        path: `u/${copy.id}/sheet/x/y.pdf`,
        mime: "application/pdf",
      });
    await eraseDemoCopy(copy.id, {
      deleteObject: async () => {
        throw new Error("R2 down");
      },
    });
    expect(await db.select().from(s.users).where(eq(s.users.id, copy.id))).toHaveLength(0);
  });
});

describe("eraseDemoUser", () => {
  it("erases the template itself with its own files, for rebuilding it", async () => {
    const other = await makeTemplateLike();
    const deleted: string[] = [];
    await eraseDemoUser(other, { deleteObject: async (k) => void deleted.push(k) });
    expect(deleted.sort()).toEqual([`u/${other}/sheet/s/a.pdf`]);
    expect(await db.select().from(s.users).where(eq(s.users.id, other))).toHaveLength(0);
  });
});

/** A second, minimal demo user with history, so erasing it leaves the shared template alone. */
async function makeTemplateLike() {
  const [u] = await db.insert(s.users).values({ demoRole: "copy", demoExpiresAt: NOW }).returning();
  const [c] = await db.insert(s.courses).values({ userId: u.id, name: "C" }).returning();
  const [sh] = await db.insert(s.sheets).values({ courseId: c.id, title: "S" }).returning();
  await db
    .insert(s.sheetFiles)
    .values({
      sheetId: sh.id,
      kind: "sheet",
      path: `u/${u.id}/sheet/s/a.pdf`,
      mime: "application/pdf",
    });
  const [q] = await db
    .insert(s.questions)
    .values({
      courseId: c.id,
      sheetId: sh.id,
      position: 1,
      label: "1",
      body: "Q",
      expectedMinutes: 5,
    })
    .returning();
  const [a] = await db
    .insert(s.attempts)
    .values({ userId: u.id, questionId: q.id, context: "sheet" })
    .returning();
  await db
    .insert(s.marks)
    .values({
      attemptId: a.id,
      basis: "ai",
      score: 1,
      outcome: "stuck",
      feedback: "f",
      overallFeedback: "o",
    });
  return u.id;
}

describe("eraseExpiredDemoCopies", () => {
  it("erases expired copies and keeps live ones, the template and real users", async () => {
    const HOUR = DAY / 24;
    const old = await createDemoCopy(new Date(NOW.getTime() - 23 * HOUR), noFiles);
    const live = await createDemoCopy(new Date(NOW.getTime() - HOUR), noFiles);
    const [real] = await db.insert(s.users).values({ email: "real3@test.local" }).returning();

    // Two hours on, the first copy is 25 hours old and the second is 3 hours old.
    const erased = await eraseExpiredDemoCopies(new Date(NOW.getTime() + 2 * HOUR), noFiles);
    expect(erased).toContain(old.id);
    expect(erased).not.toContain(live.id);
    const left = (await db.select({ id: s.users.id }).from(s.users)).map((r) => r.id);
    expect(left).not.toContain(old.id);
    expect(left).toEqual(expect.arrayContaining([live.id, template.u, real.id]));
  });

  it("erases the oldest live copies to stay under the cap", async () => {
    await eraseExpiredDemoCopies(new Date(NOW.getTime() + 10 * DAY), noFiles); // start empty
    const first = await createDemoCopy(new Date(NOW.getTime() + 1000), noFiles);
    const second = await createDemoCopy(new Date(NOW.getTime() + 2000), noFiles);
    const erased = await eraseExpiredDemoCopies(new Date(NOW.getTime() + 3000), noFiles, 2);
    expect(erased).toEqual([first.id]);
    expect(await findLiveDemoCopy(second.id, new Date(NOW.getTime() + 3000))).not.toBeNull();
  });
});

describe("createDemoCopy without a template", () => {
  it("throws DemoUnavailableError", async () => {
    await db.update(s.users).set({ demoRole: null }).where(eq(s.users.id, template.u));
    try {
      await expect(createDemoCopy(NOW, noFiles)).rejects.toBeInstanceOf(DemoUnavailableError);
    } finally {
      await db.update(s.users).set({ demoRole: "template" }).where(eq(s.users.id, template.u));
    }
  });
});
