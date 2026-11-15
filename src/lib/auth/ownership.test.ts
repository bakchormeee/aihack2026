import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  questions,
  revisionSessions,
  sheetFiles,
  sheets,
  submissionFiles,
  submissions,
  users,
} from "@/db/schema";

import {
  NotFoundError,
  requireAttempt,
  requireCourse,
  requireQuestion,
  requireRevisionSession,
  requireSheet,
  requireSheetFile,
  requireSubmissionFile,
} from "./ownership";

// Two users, each with a full chain of rows. Every helper must return the
// owner's row and refuse the other user's, with the same error as for an id
// that does not exist, so that ids cannot be probed.

async function createChain(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis 1" })
    .returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "Sheet 1" })
    .returning();
  const [sheetFile] = await db
    .insert(sheetFiles)
    .values({
      sheetId: sheet.id,
      kind: "sheet",
      path: `u/${user.id}/a.pdf`,
      mime: "application/pdf",
    })
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
  const [submission] = await db.insert(submissions).values({ attemptId: attempt.id }).returning();
  const [submissionFile] = await db
    .insert(submissionFiles)
    .values({ submissionId: submission.id, path: `u/${user.id}/w.jpg`, mime: "image/jpeg" })
    .returning();
  const [session] = await db
    .insert(revisionSessions)
    .values({ userId: user.id, courseId: course.id, targetMinutes: 20 })
    .returning();

  return { user, course, sheet, sheetFile, question, attempt, submissionFile, session };
}

const alice = await createChain("alice@test.local");
const bob = await createChain("bob@test.local");

describe("ownership helpers", () => {
  it("requireCourse returns the owner's course", async () => {
    const row = await requireCourse(alice.user.id, alice.course.id);
    expect(row.id).toBe(alice.course.id);
  });

  it("requireCourse refuses another user's course", async () => {
    await expect(requireCourse(alice.user.id, bob.course.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requireSheet returns the owner's sheet and refuses another user's", async () => {
    expect((await requireSheet(alice.user.id, alice.sheet.id)).id).toBe(alice.sheet.id);
    await expect(requireSheet(alice.user.id, bob.sheet.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requireQuestion returns the owner's question and refuses another user's", async () => {
    expect((await requireQuestion(alice.user.id, alice.question.id)).id).toBe(alice.question.id);
    await expect(requireQuestion(alice.user.id, bob.question.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("requireAttempt returns the owner's attempt and refuses another user's", async () => {
    expect((await requireAttempt(alice.user.id, alice.attempt.id)).id).toBe(alice.attempt.id);
    await expect(requireAttempt(alice.user.id, bob.attempt.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("requireSheetFile returns the owner's file and refuses another user's", async () => {
    expect((await requireSheetFile(alice.user.id, alice.sheetFile.id)).id).toBe(alice.sheetFile.id);
    await expect(requireSheetFile(alice.user.id, bob.sheetFile.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("requireSubmissionFile returns the owner's file and refuses another user's", async () => {
    expect((await requireSubmissionFile(alice.user.id, alice.submissionFile.id)).id).toBe(
      alice.submissionFile.id,
    );
    await expect(
      requireSubmissionFile(alice.user.id, bob.submissionFile.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requireRevisionSession returns the owner's session and refuses another user's", async () => {
    expect((await requireRevisionSession(alice.user.id, alice.session.id)).id).toBe(
      alice.session.id,
    );
    await expect(requireRevisionSession(alice.user.id, bob.session.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws the same error for an id that does not exist as for another user's id", async () => {
    const missing = await requireSheet(alice.user.id, "no-such-id").catch((e: unknown) => e);
    const foreign = await requireSheet(alice.user.id, bob.sheet.id).catch((e: unknown) => e);

    expect(missing).toBeInstanceOf(NotFoundError);
    expect((missing as Error).message).toBe((foreign as Error).message);
  });

  it("refuses a variant question that belongs to another user's course", async () => {
    // A variant has no sheet; ownership must come through the course.
    const [variant] = await db
      .insert(questions)
      .values({
        courseId: bob.course.id,
        sheetId: null,
        position: 1,
        label: "V",
        body: "V",
        expectedMinutes: 5,
        source: "variant",
      })
      .returning();

    await expect(requireQuestion(alice.user.id, variant.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await requireQuestion(bob.user.id, variant.id)).id).toBe(variant.id);
  });
});

describe("ownership helpers and the bin", () => {
  /** A chain whose question has a variant, and the variant a variant of its own. */
  async function chainWithVariants(email: string) {
    const chain = await createChain(email);
    const variant = async (parentId: string) =>
      (
        await db
          .insert(questions)
          .values({
            courseId: chain.course.id,
            sheetId: null,
            position: 1,
            label: "V",
            body: "V",
            expectedMinutes: 5,
            source: "variant",
            parentQuestionId: parentId,
          })
          .returning()
      )[0];
    const v1 = await variant(chain.question.id);
    const v2 = await variant(v1.id);
    const [v2Attempt] = await db
      .insert(attempts)
      .values({ userId: chain.user.id, questionId: v2.id, context: "revision" })
      .returning();
    // A second sheet that stays out of the bin.
    const [other] = await db
      .insert(sheets)
      .values({ courseId: chain.course.id, title: "Sheet 2" })
      .returning();
    const [otherQuestion] = await db
      .insert(questions)
      .values({
        courseId: chain.course.id,
        sheetId: other.id,
        position: 1,
        label: "1",
        body: "Q",
        expectedMinutes: 5,
      })
      .returning();
    return { ...chain, v1, v2, v2Attempt, other, otherQuestion };
  }

  const refused = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);

  it("refuses everything in a binned course", async () => {
    const c = await chainWithVariants("bin-course@test.local");
    await db.update(courses).set({ deletedAt: new Date() }).where(eq(courses.id, c.course.id));
    const u = c.user.id;

    await refused(requireCourse(u, c.course.id));
    await refused(requireSheet(u, c.sheet.id));
    await refused(requireSheet(u, c.other.id));
    await refused(requireQuestion(u, c.question.id));
    await refused(requireQuestion(u, c.v2.id));
    await refused(requireAttempt(u, c.attempt.id));
    await refused(requireSheetFile(u, c.sheetFile.id));
    await refused(requireSubmissionFile(u, c.submissionFile.id));
    await refused(requireRevisionSession(u, c.session.id));
  });

  it("refuses a binned sheet with its questions, their variants, attempts and files", async () => {
    const c = await chainWithVariants("bin-sheet@test.local");
    await db.update(sheets).set({ deletedAt: new Date() }).where(eq(sheets.id, c.sheet.id));
    const u = c.user.id;

    await refused(requireSheet(u, c.sheet.id));
    await refused(requireQuestion(u, c.question.id));
    await refused(requireQuestion(u, c.v1.id));
    await refused(requireQuestion(u, c.v2.id));
    await refused(requireAttempt(u, c.attempt.id));
    await refused(requireAttempt(u, c.v2Attempt.id));
    await refused(requireSheetFile(u, c.sheetFile.id));
    await refused(requireSubmissionFile(u, c.submissionFile.id));

    // The course, the other sheet and the revision session are still there.
    expect((await requireCourse(u, c.course.id)).id).toBe(c.course.id);
    expect((await requireSheet(u, c.other.id)).id).toBe(c.other.id);
    expect((await requireQuestion(u, c.otherQuestion.id)).id).toBe(c.otherQuestion.id);
    expect((await requireRevisionSession(u, c.session.id)).id).toBe(c.session.id);
  });

  it("gives everything back once the bin date is cleared", async () => {
    const c = await chainWithVariants("bin-back@test.local");
    await db.update(sheets).set({ deletedAt: new Date() }).where(eq(sheets.id, c.sheet.id));
    await db.update(sheets).set({ deletedAt: null }).where(eq(sheets.id, c.sheet.id));

    expect((await requireQuestion(c.user.id, c.v2.id)).id).toBe(c.v2.id);
    expect((await requireAttempt(c.user.id, c.v2Attempt.id)).id).toBe(c.v2Attempt.id);
    expect((await requireSubmissionFile(c.user.id, c.submissionFile.id)).id).toBe(
      c.submissionFile.id,
    );
  });
});
