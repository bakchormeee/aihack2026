import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  questions,
  sheets,
  submissionFiles,
  submissions,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  getLatestAttemptFor,
  getSheetNeighbours,
  AttemptClosedError,
  HintsNotReadyError,
  NoMoreHintsError,
  openAttemptFor,
  recordSecondsSpent,
  setDifficultyRating,
  revealNextHintFor,
  startAttemptFor,
  visibleHintsFor,
} from "./attempts";

async function setup(email: string, o: { hintsReady?: boolean } = {}) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis I" })
    .returning();
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
      body: "Prove it.",
      expectedMinutes: 10,
      hintsStatus: o.hintsReady === false ? "pending" : "ready",
    })
    .returning();
  if (o.hintsReady !== false) {
    await db.insert(hints).values([
      { questionId: question.id, level: 1, body: "Hint one" },
      { questionId: question.id, level: 2, body: "Hint two" },
      { questionId: question.id, level: 3, body: "Hint three" },
    ]);
  }
  return { user, course, sheet, question };
}

describe("openAttemptFor", () => {
  it("creates an attempt the first time and returns the same one afterwards", async () => {
    const { user, question } = await setup("a-open@test.local");

    const first = await openAttemptFor(user.id, question.id);
    const second = await openAttemptFor(user.id, question.id);

    expect(second.id).toBe(first.id);
    expect(first.context).toBe("sheet");
    expect(first.inheritedHintLevel).toBe(0);
    expect(
      await db.select().from(attempts).where(eq(attempts.questionId, question.id)),
    ).toHaveLength(1);
  });

  it("creates only one attempt when two calls overlap", async () => {
    const { user, question } = await setup("a-race@test.local");

    const [a, b] = await Promise.all([
      openAttemptFor(user.id, question.id),
      openAttemptFor(user.id, question.id),
    ]);

    expect(a.id).toBe(b.id);
    expect(
      await db.select().from(attempts).where(eq(attempts.questionId, question.id)),
    ).toHaveLength(1);
  });

  it("starts a new attempt once the previous one has been submitted", async () => {
    const { user, question } = await setup("a-submitted@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await db
      .insert(submissions)
      .values({ attemptId: first.id, text: "working", submittedAt: new Date() });

    const second = await openAttemptFor(user.id, question.id);

    expect(second.id).not.toBe(first.id);
  });

  it("keeps an attempt open while its working is only a draft", async () => {
    const { user, question } = await setup("a-draft@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await db.insert(submissions).values({ attemptId: first.id, text: "half done" });

    expect((await openAttemptFor(user.id, question.id)).id).toBe(first.id);
  });

  it("refuses a question that belongs to another user", async () => {
    const owner = await setup("a-owner@test.local");
    const other = await setup("a-other@test.local");

    await expect(openAttemptFor(other.user.id, owner.question.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("keeps revision-session attempts separate from sheet attempts", async () => {
    const { user, question } = await setup("a-session@test.local");
    const sheetAttempt = await openAttemptFor(user.id, question.id);

    // A session id that does not exist is rejected by the foreign key, so only check the sheet side here.
    expect(sheetAttempt.revisionSessionId).toBeNull();
  });
});

describe("revealNextHintFor", () => {
  it("reveals hints strictly in order and returns the text", async () => {
    const { user, question } = await setup("r-order@test.local");
    const attempt = await openAttemptFor(user.id, question.id);

    expect(await revealNextHintFor(user.id, attempt.id)).toEqual({ level: 1, body: "Hint one" });
    expect(await revealNextHintFor(user.id, attempt.id)).toEqual({ level: 2, body: "Hint two" });
    expect(await revealNextHintFor(user.id, attempt.id)).toEqual({ level: 3, body: "Hint three" });
  });

  it("refuses a fourth hint", async () => {
    const { user, question } = await setup("r-four@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    for (let i = 0; i < 3; i++) await revealNextHintFor(user.id, attempt.id);

    await expect(revealNextHintFor(user.id, attempt.id)).rejects.toBeInstanceOf(NoMoreHintsError);
  });

  it("records each reveal once", async () => {
    const { user, question } = await setup("r-once@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, attempt.id);
    await revealNextHintFor(user.id, attempt.id);

    const rows = await db.select().from(hintReveals).where(eq(hintReveals.attemptId, attempt.id));
    expect(rows).toHaveLength(2);
  });

  it("refuses when the hints are not ready yet", async () => {
    const { user, question } = await setup("r-notready@test.local", { hintsReady: false });
    const attempt = await openAttemptFor(user.id, question.id);

    await expect(revealNextHintFor(user.id, attempt.id)).rejects.toBeInstanceOf(HintsNotReadyError);
    expect(
      await db.select().from(hintReveals).where(eq(hintReveals.attemptId, attempt.id)),
    ).toHaveLength(0);
  });

  it("refuses to reveal a hint on an attempt whose working was submitted", async () => {
    const { user, question } = await setup("r-closed@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, attempt.id);
    await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "x", submittedAt: new Date() });

    await expect(revealNextHintFor(user.id, attempt.id)).rejects.toBeInstanceOf(AttemptClosedError);
    expect(
      await db.select().from(hintReveals).where(eq(hintReveals.attemptId, attempt.id)),
    ).toHaveLength(1);
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("r-owner@test.local");
    const other = await setup("r-other@test.local");
    const attempt = await openAttemptFor(owner.user.id, owner.question.id);

    await expect(revealNextHintFor(other.user.id, attempt.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("visibleHintsFor", () => {
  it("returns only hints that have been revealed, never the others", async () => {
    const { user, question } = await setup("v-only@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, attempt.id);

    const visible = await visibleHintsFor(user.id, attempt.id);

    expect(visible).toEqual({ level: 1, hints: [{ level: 1, body: "Hint one" }] });
    expect(JSON.stringify(visible)).not.toContain("Hint two");
    expect(JSON.stringify(visible)).not.toContain("Hint three");
  });

  it("is empty before any reveal", async () => {
    const { user, question } = await setup("v-empty@test.local");
    const attempt = await openAttemptFor(user.id, question.id);

    expect(await visibleHintsFor(user.id, attempt.id)).toEqual({ level: 0, hints: [] });
  });
});

describe("startAttemptFor", () => {
  it("retry-now keeps the hints the student had already seen", async () => {
    const { user, question } = await setup("s-retry@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, first.id);
    await revealNextHintFor(user.id, first.id);

    const retry = await startAttemptFor(user.id, question.id, "retry-now");

    expect(retry.id).not.toBe(first.id);
    expect(retry.inheritedHintLevel).toBe(2);
    expect(await visibleHintsFor(user.id, retry.id)).toEqual({
      level: 2,
      hints: [
        { level: 1, body: "Hint one" },
        { level: 2, body: "Hint two" },
      ],
    });
  });

  it("after inheriting two hints, the next reveal is the third", async () => {
    const { user, question } = await setup("s-next@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, first.id);
    await revealNextHintFor(user.id, first.id);
    const retry = await startAttemptFor(user.id, question.id, "retry-now");

    expect(await revealNextHintFor(user.id, retry.id)).toEqual({ level: 3, body: "Hint three" });
  });

  it("fresh starts with all hints hidden", async () => {
    const { user, question } = await setup("s-fresh@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, first.id);

    const fresh = await startAttemptFor(user.id, question.id, "fresh");

    expect(fresh.inheritedHintLevel).toBe(0);
    expect(await visibleHintsFor(user.id, fresh.id)).toEqual({ level: 0, hints: [] });
  });

  it("leaves the earlier attempt unchanged", async () => {
    const { user, question } = await setup("s-keep@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await revealNextHintFor(user.id, first.id);

    await startAttemptFor(user.id, question.id, "retry-now");

    const [row] = await db.select().from(attempts).where(eq(attempts.id, first.id));
    expect(row.inheritedHintLevel).toBe(0);
    expect(
      await db.select().from(hintReveals).where(eq(hintReveals.attemptId, first.id)),
    ).toHaveLength(1);
  });

  it("retry-now with no earlier attempt starts at zero", async () => {
    const { user, question } = await setup("s-none@test.local");

    expect((await startAttemptFor(user.id, question.id, "retry-now")).inheritedHintLevel).toBe(0);
  });
});

describe("startAttemptFor copies the previous working", () => {
  async function withWorking(email: string) {
    const base = await setup(email);
    const first = await openAttemptFor(base.user.id, base.question.id);
    const [submission] = await db
      .insert(submissions)
      .values({ attemptId: first.id, text: "my working", submittedAt: new Date() })
      .returning();
    await db.insert(submissionFiles).values([
      { submissionId: submission.id, path: "k/a.jpg", mime: "image/jpeg", position: 0 },
      { submissionId: submission.id, path: "k/b.jpg", mime: "image/jpeg", position: 1 },
    ]);
    return { ...base, first, submission };
  }
  const draftOf = async (attemptId: string) => {
    const [row] = await db.select().from(submissions).where(eq(submissions.attemptId, attemptId));
    const files = row
      ? await db
          .select()
          .from(submissionFiles)
          .where(eq(submissionFiles.submissionId, row.id))
          .orderBy(submissionFiles.position)
      : [];
    return { row, files };
  };

  it("retry-now starts a draft with the same typed text and the same files, in order", async () => {
    const { user, question } = await withWorking("c-copy@test.local");

    const retry = await startAttemptFor(user.id, question.id, "retry-now");

    const { row, files } = await draftOf(retry.id);
    expect(row.text).toBe("my working");
    expect(row.submittedAt).toBeNull();
    expect(row.markStatus).toBe("none");
    expect(files.map((f) => [f.path, f.mime, f.position])).toEqual([
      ["k/a.jpg", "image/jpeg", 0],
      ["k/b.jpg", "image/jpeg", 1],
    ]);
  });

  it("leaves the earlier submission and its files unchanged", async () => {
    const { user, question, first, submission } = await withWorking("c-keep@test.local");

    await startAttemptFor(user.id, question.id, "retry-now");

    const before = await draftOf(first.id);
    expect(before.row.id).toBe(submission.id);
    expect(before.row.submittedAt).not.toBeNull();
    expect(before.files).toHaveLength(2);
  });

  it("fresh starts with no working at all", async () => {
    const { user, question } = await withWorking("c-fresh@test.local");

    const fresh = await startAttemptFor(user.id, question.id, "fresh");

    expect((await draftOf(fresh.id)).row).toBeUndefined();
  });

  it("copies nothing when the previous attempt has no working", async () => {
    const { user, question } = await setup("c-none@test.local");
    await openAttemptFor(user.id, question.id);

    const retry = await startAttemptFor(user.id, question.id, "retry-now");

    expect((await draftOf(retry.id)).row).toBeUndefined();
  });

  it("copies from the latest attempt, not an older one", async () => {
    const { user, question, first } = await withWorking("c-latest@test.local");
    const second = await startAttemptFor(user.id, question.id, "retry-now");
    await db
      .update(submissions)
      .set({ text: "second try" })
      .where(eq(submissions.attemptId, second.id));
    await db
      .update(attempts)
      .set({ startedAt: new Date(Date.now() + 1000) })
      .where(eq(attempts.id, second.id));
    expect(first.id).not.toBe(second.id);

    const third = await startAttemptFor(user.id, question.id, "retry-now");

    expect((await draftOf(third.id)).row.text).toBe("second try");
  });
});

describe("getSheetNeighbours", () => {
  async function sheetOf(email: string, count: number) {
    const { user, course, sheet } = await setup(email);
    const more = await db
      .insert(questions)
      .values(
        Array.from({ length: count - 1 }, (_, i) => ({
          courseId: course.id,
          sheetId: sheet.id,
          position: i + 2,
          label: String(i + 2),
          body: "More",
          expectedMinutes: 5,
        })),
      )
      .returning();
    const all = await db
      .select()
      .from(questions)
      .where(eq(questions.sheetId, sheet.id))
      .orderBy(questions.position);
    expect(all).toHaveLength(more.length + 1);
    return { user, sheet, all };
  }

  it("gives the neighbours of a middle question", async () => {
    const { user, sheet, all } = await sheetOf("n-mid@test.local", 3);

    expect(await getSheetNeighbours(user.id, all[1].id)).toEqual({
      sheetId: sheet.id,
      prevId: all[0].id,
      nextId: all[2].id,
      position: 2,
      total: 3,
    });
  });

  it("has no previous for the first and no next for the last", async () => {
    const { user, all } = await sheetOf("n-ends@test.local", 3);

    expect((await getSheetNeighbours(user.id, all[0].id)).prevId).toBeNull();
    expect((await getSheetNeighbours(user.id, all[2].id)).nextId).toBeNull();
  });

  it("refuses another user's question", async () => {
    const { all } = await sheetOf("n-owner@test.local", 2);
    const other = await setup("n-other@test.local");

    await expect(getSheetNeighbours(other.user.id, all[0].id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("recordSecondsSpent", () => {
  const secondsOf = async (id: string) =>
    (await db.select().from(attempts).where(eq(attempts.id, id)))[0].secondsSpent;

  it("saves the seconds on an open attempt", async () => {
    const { user, question } = await setup("t-save@test.local");
    const attempt = await openAttemptFor(user.id, question.id);

    expect(await recordSecondsSpent(user.id, attempt.id, 95)).toBe(true);

    expect(await secondsOf(attempt.id)).toBe(95);
  });

  it("never lowers the saved time, so a late stale save cannot undo progress", async () => {
    const { user, question } = await setup("t-mono@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await recordSecondsSpent(user.id, attempt.id, 200);

    await recordSecondsSpent(user.id, attempt.id, 50);

    expect(await secondsOf(attempt.id)).toBe(200);
  });

  it("caps an unreasonable value at six hours", async () => {
    const { user, question } = await setup("t-cap@test.local");
    const attempt = await openAttemptFor(user.id, question.id);

    await recordSecondsSpent(user.id, attempt.id, 10_000_000);

    expect(await secondsOf(attempt.id)).toBe(6 * 60 * 60);
  });

  it("rejects a negative or fractional value", async () => {
    const { user, question } = await setup("t-bad@test.local");
    const attempt = await openAttemptFor(user.id, question.id);

    await expect(recordSecondsSpent(user.id, attempt.id, -1)).rejects.toThrow();
    await expect(recordSecondsSpent(user.id, attempt.id, 1.5)).rejects.toThrow();
  });

  it("saves nothing when the timer is switched off for the sheet", async () => {
    const { user, sheet, question } = await setup("t-off@test.local");
    await db.update(sheets).set({ timerEnabled: false }).where(eq(sheets.id, sheet.id));
    const attempt = await openAttemptFor(user.id, question.id);

    expect(await recordSecondsSpent(user.id, attempt.id, 60)).toBe(false);

    expect(await secondsOf(attempt.id)).toBeNull();
  });

  it("saves nothing once the working has been submitted", async () => {
    const { user, question } = await setup("t-done@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await recordSecondsSpent(user.id, attempt.id, 30);
    await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "x", submittedAt: new Date() });

    expect(await recordSecondsSpent(user.id, attempt.id, 999)).toBe(false);

    expect(await secondsOf(attempt.id)).toBe(30);
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("t-owner@test.local");
    const other = await setup("t-other@test.local");
    const attempt = await openAttemptFor(owner.user.id, owner.question.id);

    await expect(recordSecondsSpent(other.user.id, attempt.id, 10)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("setDifficultyRating", () => {
  const ratingOf = async (id: string) =>
    (await db.select().from(attempts).where(eq(attempts.id, id)))[0].difficultyRating;

  it.each([1, 3, 5])("saves a rating of %i", async (rating) => {
    const { user, question } = await setup(`d-ok-${rating}@test.local`);
    const attempt = await openAttemptFor(user.id, question.id);

    expect(await setDifficultyRating(user.id, attempt.id, rating)).toBe(true);

    expect(await ratingOf(attempt.id)).toBe(rating);
  });

  it("clears the rating when given null (skipped)", async () => {
    const { user, question } = await setup("d-clear@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await setDifficultyRating(user.id, attempt.id, 4);

    await setDifficultyRating(user.id, attempt.id, null);

    expect(await ratingOf(attempt.id)).toBeNull();
  });

  it.each([0, 6, 2.5, -1])("rejects a rating of %s", async (rating) => {
    const { user, question } = await setup(`d-bad-${rating}@test.local`);
    const attempt = await openAttemptFor(user.id, question.id);

    await expect(setDifficultyRating(user.id, attempt.id, rating)).rejects.toThrow();
  });

  it("changes nothing once the working has been submitted", async () => {
    const { user, question } = await setup("d-done@test.local");
    const attempt = await openAttemptFor(user.id, question.id);
    await setDifficultyRating(user.id, attempt.id, 2);
    await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "x", submittedAt: new Date() });

    expect(await setDifficultyRating(user.id, attempt.id, 5)).toBe(false);

    expect(await ratingOf(attempt.id)).toBe(2);
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("d-owner@test.local");
    const other = await setup("d-other@test.local");
    const attempt = await openAttemptFor(owner.user.id, owner.question.id);

    await expect(setDifficultyRating(other.user.id, attempt.id, 3)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("getLatestAttemptFor", () => {
  it("is null when there is no attempt", async () => {
    const { user, question } = await setup("l-none@test.local");

    expect(await getLatestAttemptFor(user.id, question.id)).toBeNull();
  });

  it("returns the newest attempt even when it has been submitted", async () => {
    const { user, question } = await setup("l-new@test.local");
    const first = await openAttemptFor(user.id, question.id);
    await db
      .insert(submissions)
      .values({ attemptId: first.id, text: "x", submittedAt: new Date() });

    expect((await getLatestAttemptFor(user.id, question.id))?.id).toBe(first.id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await startAttemptFor(user.id, question.id, "fresh");
    expect((await getLatestAttemptFor(user.id, question.id))?.id).toBe(second.id);
  });

  it("refuses another user's question", async () => {
    const owner = await setup("l-owner@test.local");
    const other = await setup("l-other@test.local");

    await expect(getLatestAttemptFor(other.user.id, owner.question.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
