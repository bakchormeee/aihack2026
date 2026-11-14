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
