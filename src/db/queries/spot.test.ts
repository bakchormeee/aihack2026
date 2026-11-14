import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { getSpotSession, misconceptionDescriptions } from "@/db/queries/spot";
import {
  courses,
  misconceptions,
  revisionSessions,
  spotAnswers,
  spotItems,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [session] = await db
    .insert(revisionSessions)
    .values({
      userId: user.id,
      courseId: course.id,
      mode: "spot_error",
      questionCount: 3,
      status: "ready",
    })
    .returning();
  const [a, b] = await db
    .insert(misconceptions)
    .values([
      { userId: user.id, courseId: course.id, description: "Error A", errorType: "method" },
      { userId: user.id, courseId: course.id, description: "Error B", errorType: "method" },
    ])
    .returning();
  const item = (position: number, planted: { line: number; misconceptionId: string }[]) =>
    db
      .insert(spotItems)
      .values({
        sessionId: session.id,
        position,
        body: "Q",
        lines: ["a", "b", "c", "d"],
        planted: planted.map((p) => ({ ...p, whatsWrong: "w", correctLine: "c" })),
        topicIds: [],
      })
      .returning();
  return { user, course, session, a, b, item };
}

describe("getSpotSession", () => {
  it("lists the questions in order with their outcomes, and is not done while one is unanswered", async () => {
    const w = await setup("gs-open@test.local");
    const [i1] = await w.item(1, [{ line: 2, misconceptionId: w.a.id }]);
    await w.item(2, []);
    await db.insert(spotAnswers).values({
      itemId: i1.id,
      userId: w.user.id,
      answeredAt: new Date(),
      ticked: [{ line: 2, explanation: "x" }],
      judgements: [{ line: 2, right: true, comment: "c" }],
      outcome: "full",
    });

    const view = await getSpotSession(w.user.id, w.session.id);

    expect(view.items).toEqual([
      { position: 1, answered: true, outcome: "full" },
      { position: 2, answered: false, outcome: null },
    ]);
    expect(view.done).toBe(false);
    expect(view.counts).toEqual({ full: 1, partial: 0, stuck: 0 });
  });

  it("treats an answer that was taken but never judged as unanswered once it is stale", async () => {
    const w = await setup("gs-abandoned@test.local");
    const [i1] = await w.item(1, []);
    const [i2] = await w.item(2, []);
    const now = new Date("2026-11-14T12:00:00Z");
    const unjudged = (itemId: string, minutesAgo: number) => ({
      itemId,
      userId: w.user.id,
      answeredAt: new Date(now.getTime() - minutesAgo * 60_000),
      noError: true,
    });
    await db.insert(spotAnswers).values([unjudged(i1.id, 1), unjudged(i2.id, 4)]);

    const view = await getSpotSession(w.user.id, w.session.id, now);

    expect(view.items).toEqual([
      { position: 1, answered: true, outcome: null },
      { position: 2, answered: false, outcome: null },
    ]);
    expect(view.done).toBe(false);
  });

  it("is done once every question is answered, with counts and the common errors that were missed", async () => {
    const w = await setup("gs-done@test.local");
    const [i1] = await w.item(1, [{ line: 2, misconceptionId: w.a.id }]);
    const [i2] = await w.item(2, [
      { line: 1, misconceptionId: w.a.id },
      { line: 3, misconceptionId: w.b.id },
    ]);
    await db.insert(spotAnswers).values([
      {
        itemId: i1.id,
        userId: w.user.id,
        answeredAt: new Date(),
        ticked: [],
        noError: true,
        outcome: "stuck",
      },
      {
        itemId: i2.id,
        userId: w.user.id,
        answeredAt: new Date(),
        ticked: [
          { line: 1, explanation: "x" },
          { line: 3, explanation: "y" },
        ],
        judgements: [
          { line: 1, right: true, comment: "c" },
          { line: 3, right: false, comment: "c" },
        ],
        outcome: "partial",
      },
    ]);

    const view = await getSpotSession(w.user.id, w.session.id);

    expect(view.done).toBe(true);
    expect(view.counts).toEqual({ full: 0, partial: 1, stuck: 1 });
    expect(view.missed.sort()).toEqual(["Error A", "Error B"]); // A missed in Q1, B explained wrong in Q2
  });

  it("is not done with no questions, and refuses another student's or a long-form session", async () => {
    const w = await setup("gs-empty@test.local");
    const other = await setup("gs-other@test.local");

    expect((await getSpotSession(w.user.id, w.session.id)).done).toBe(false);
    await expect(getSpotSession(other.user.id, w.session.id)).rejects.toBeInstanceOf(NotFoundError);
    const [long] = await db
      .insert(revisionSessions)
      .values({ userId: w.user.id, courseId: w.course.id, targetMinutes: 20 })
      .returning();
    await expect(getSpotSession(w.user.id, long.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("misconceptionDescriptions", () => {
  it("returns descriptions by id, and nothing for no ids", async () => {
    const w = await setup("md@test.local");

    expect(await misconceptionDescriptions([])).toEqual(new Map());
    expect((await misconceptionDescriptions([w.a.id, w.a.id])).get(w.a.id)).toBe("Error A");
  });
});
