import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { attempts, courses, questions, sheets, solutions, submissions, users } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import { claimMark, holdForOfficial } from "./mark";
import { resolveMarkWithAi, startMarking } from "./start-marking";

async function world(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const [withOfficial, without] = await db
    .insert(questions)
    .values(
      ["1", "2"].map((label, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label,
        body: "B",
        expectedMinutes: 5,
      })),
    )
    .returning();
  for (const q of [withOfficial, without])
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "ai" });
  await db
    .insert(solutions)
    .values({ questionId: withOfficial.id, basis: "official", body: "official" });
  return { user, sheet, withOfficial, without };
}

async function submitted(userId: string, questionId: string) {
  const [attempt] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({ attemptId: attempt.id, text: "x", submittedAt: new Date() })
    .returning();
  return submission;
}

const statusOf = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0].markStatus;

describe("resolveMarkWithAi", () => {
  it("uses the sheet's position when the form sent none, and saves one that was sent", async () => {
    const w = await world("sm-switch@test.local");

    expect(await resolveMarkWithAi(w.user.id, w.sheet.id, undefined)).toBe(true);
    expect(await resolveMarkWithAi(w.user.id, w.sheet.id, false)).toBe(false);
    // Turning it off once covers the rest of the sheet.
    expect(await resolveMarkWithAi(w.user.id, w.sheet.id, undefined)).toBe(false);
    expect((await db.select().from(sheets).where(eq(sheets.id, w.sheet.id)))[0].markWithAi).toBe(
      false,
    );
    expect(await resolveMarkWithAi(w.user.id, w.sheet.id, true)).toBe(true);
    expect(await resolveMarkWithAi(w.user.id, w.sheet.id, undefined)).toBe(true);
  });

  it("marks with the AI unless told otherwise for a question without a sheet", async () => {
    const w = await world("sm-nosheet@test.local");
    expect(await resolveMarkWithAi(w.user.id, null, undefined)).toBe(true);
    expect(await resolveMarkWithAi(w.user.id, null, false)).toBe(false);
  });

  it("refuses another user's sheet and leaves its position alone", async () => {
    const owner = await world("sm-owner@test.local");
    const other = await world("sm-other@test.local");
    await expect(resolveMarkWithAi(other.user.id, owner.sheet.id, false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(
      (await db.select().from(sheets).where(eq(sheets.id, owner.sheet.id)))[0].markWithAi,
    ).toBe(true);
  });
});

describe("startMarking", () => {
  it("claims an AI mark when the switch is on and the question has no official solution", async () => {
    const w = await world("sm-ai@test.local");
    const sub = await submitted(w.user.id, w.without.id);

    const claims = await startMarking([sub.id], true);

    expect(claims.map((c) => [c.submissionId, c.basis])).toEqual([[sub.id, "ai"]]);
    expect(await statusOf(sub.id)).toBe("pending");
  });

  it("leaves the submission waiting, with no claim, when the switch is off", async () => {
    const w = await world("sm-wait@test.local");
    const sub = await submitted(w.user.id, w.without.id);

    expect(await startMarking([sub.id], false)).toEqual([]);
    expect(await statusOf(sub.id)).toBe("awaiting_official");
  });

  it("claims an official mark when the question has an official solution, whatever the switch says", async () => {
    const w = await world("sm-off@test.local");
    for (const markWithAi of [true, false]) {
      const sub = await submitted(w.user.id, w.withOfficial.id);
      const claims = await startMarking([sub.id], markWithAi);
      expect(claims.map((c) => c.basis)).toEqual(["official"]);
      expect(await statusOf(sub.id)).toBe("pending");
    }
  });

  it("plans each question of a batch on its own", async () => {
    const w = await world("sm-mixed@test.local");
    const a = await submitted(w.user.id, w.withOfficial.id);
    const b = await submitted(w.user.id, w.without.id);

    const claims = await startMarking([a.id, b.id], false);

    expect(claims.map((c) => [c.submissionId, c.basis])).toEqual([[a.id, "official"]]);
    expect(await statusOf(a.id)).toBe("pending");
    expect(await statusOf(b.id)).toBe("awaiting_official");
  });

  it("does nothing for no submissions", async () => {
    expect(await startMarking([], true)).toEqual([]);
  });
});

describe("holdForOfficial and claimMark", () => {
  it("holds only a submitted submission that has not been marked", async () => {
    const w = await world("sm-hold@test.local");
    const sub = await submitted(w.user.id, w.without.id);
    expect(await holdForOfficial(sub.id)).toBe(true);
    expect(await holdForOfficial(sub.id)).toBe(false); // already waiting

    const [attempt] = await db
      .insert(attempts)
      .values({ userId: w.user.id, questionId: w.without.id, context: "sheet" })
      .returning();
    const [draft] = await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "draft" })
      .returning();
    expect(await holdForOfficial(draft.id)).toBe(false); // not submitted
    expect(await statusOf(draft.id)).toBe("none");
  });

  it("lets a waiting submission be marked by the AI instead, or against the official solution", async () => {
    const w = await world("sm-claim@test.local");
    const first = await submitted(w.user.id, w.without.id);
    const second = await submitted(w.user.id, w.without.id);
    await holdForOfficial(first.id);
    await holdForOfficial(second.id);

    expect((await claimMark({ submissionId: first.id, basis: "ai" }))?.basis).toBe("ai");
    expect((await claimMark({ submissionId: second.id, basis: "official" }))?.basis).toBe(
      "official",
    );
    // A second claim while it is being marked finds nothing to take.
    expect(await claimMark({ submissionId: first.id, basis: "ai" })).toBeNull();
  });
});
