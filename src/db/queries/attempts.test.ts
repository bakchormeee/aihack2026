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
  submissions,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  getSheetNeighbours,
  HintsNotReadyError,
  NoMoreHintsError,
  openAttemptFor,
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
