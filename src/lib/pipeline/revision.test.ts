import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hints,
  marks,
  questions,
  questionTopics,
  revisionItems,
  revisionSessions,
  solutions,
  topics,
  users,
} from "@/db/schema";

import { buildRevisionSession, type RevisionIo } from "./revision";

const DAY = 24 * 60 * 60 * 1000;

const variantAnswer = {
  body: "Variant body $x^2$",
  solution: "Variant solution",
  finalAnswer: "42",
  hints: ["h1", "h2", "h3"] as [string, string, string],
  expectedMinutes: 8,
};
const okIo: RevisionIo = { generateVariant: async () => variantAnswer };

async function setup(email: string, o: { target?: number; topicFilter?: "t1" | "t2" } = {}) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [t1, t2] = await db
    .insert(topics)
    .values([
      { courseId: course.id, name: "Limits" },
      { courseId: course.id, name: "Series" },
    ])
    .returning();
  const make = async (position: number, topicId: string, outcome: "stuck" | "partial") => {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        position,
        label: `Q${position}`,
        body: `Body ${position}`,
        expectedMinutes: 10,
        hintsStatus: "ready",
      })
      .returning();
    await db.insert(questionTopics).values({ questionId: q.id, topicId });
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: `Sol ${position}` });
    const [a] = await db
      .insert(attempts)
      .values({
        userId: user.id,
        questionId: q.id,
        context: "sheet",
        startedAt: new Date(Date.now() - 3 * DAY),
      })
      .returning();
    await db.insert(marks).values({
      attemptId: a.id,
      basis: "ai",
      score: outcome === "stuck" ? 0 : outcome === "partial" ? 3 : 5,
      outcome,
      firstWrongStep: "step 2",
      feedback: "f",
      overallFeedback: "o",
    });
    return q;
  };
  const q1 = await make(1, t1.id, "stuck");
  const q2 = await make(2, t2.id, "partial");
  const [session] = await db
    .insert(revisionSessions)
    .values({
      userId: user.id,
      courseId: course.id,
      targetMinutes: o.target ?? 45,
      topicIds: o.topicFilter === "t2" ? [t2.id] : o.topicFilter === "t1" ? [t1.id] : null,
    })
    .returning();
  return { user, course, t1, t2, q1, q2, session };
}

const sessionRow = async (id: string) =>
  (await db.select().from(revisionSessions).where(eq(revisionSessions.id, id)))[0];
const itemsOf = (id: string) =>
  db
    .select()
    .from(revisionItems)
    .where(eq(revisionItems.sessionId, id))
    .orderBy(revisionItems.position);

describe("buildRevisionSession", () => {
  it("saves retry and variant items in order and sets the session ready", async () => {
    const { session, q1, q2 } = await setup("rb-ok@test.local");

    await buildRevisionSession(session.id, okIo);

    expect((await sessionRow(session.id)).status).toBe("ready");
    const items = await itemsOf(session.id);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(items.map((i) => i.source)).toEqual(["retry", "retry", "variant", "variant"]);
    expect(
      items
        .slice(0, 2)
        .map((i) => i.questionId)
        .sort(),
    ).toEqual([q1.id, q2.id].sort());
    expect(items.every((i) => i.reason.length > 0)).toBe(true);
  });

  it("saves each variant with parent, topics, three hints and an AI solution", async () => {
    const { session, course, q1, t1 } = await setup("rb-variant@test.local", { topicFilter: "t1" });
    const generate = vi.fn(okIo.generateVariant);

    await buildRevisionSession(session.id, { generateVariant: generate });

    const variantItem = (await itemsOf(session.id)).find((i) => i.source === "variant")!;
    const [variant] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, variantItem.questionId));
    expect(variant).toMatchObject({
      courseId: course.id,
      sheetId: null,
      source: "variant",
      parentQuestionId: q1.id,
      hintsStatus: "ready",
      body: variantAnswer.body,
      expectedMinutes: 8,
    });
    expect(
      (await db.select().from(questionTopics).where(eq(questionTopics.questionId, variant.id))).map(
        (t) => t.topicId,
      ),
    ).toEqual([t1.id]);
    expect(
      (
        await db.select().from(hints).where(eq(hints.questionId, variant.id)).orderBy(hints.level)
      ).map((h) => h.body),
    ).toEqual(["h1", "h2", "h3"]);
    const [sol] = await db.select().from(solutions).where(eq(solutions.questionId, variant.id));
    expect(sol).toMatchObject({ basis: "ai", body: "Variant solution" });
    expect(generate).toHaveBeenCalledWith({
      parentBody: "Body 1",
      parentSolution: "Sol 1",
      errorSummary: expect.stringContaining("step 2"),
    });
  });

  it("only uses candidates tagged with the session's topics", async () => {
    const { session, q2 } = await setup("rb-topic@test.local", { topicFilter: "t2" });

    await buildRevisionSession(session.id, okIo);

    const items = await itemsOf(session.id);
    expect(items.find((i) => i.source === "retry")!.questionId).toBe(q2.id);
    expect(items.filter((i) => i.source === "retry")).toHaveLength(1);
  });

  it("does nothing on a rerun: no duplicate items or variants", async () => {
    const { session, course } = await setup("rb-rerun@test.local");
    await buildRevisionSession(session.id, okIo);
    const before = (await db.select().from(questions).where(eq(questions.courseId, course.id)))
      .length;

    await buildRevisionSession(session.id, okIo);

    expect(await itemsOf(session.id)).toHaveLength(4);
    expect(
      (await db.select().from(questions).where(eq(questions.courseId, course.id))).length,
    ).toBe(before);
  });

  it("is safe when two runs overlap", async () => {
    const { session, course } = await setup("rb-overlap@test.local");

    await Promise.all([
      buildRevisionSession(session.id, okIo),
      buildRevisionSession(session.id, okIo),
    ]);

    expect(await itemsOf(session.id)).toHaveLength(4);
    const variants = (
      await db.select().from(questions).where(eq(questions.courseId, course.id))
    ).filter((q) => q.source === "variant");
    expect(variants).toHaveLength(2);
    expect((await sessionRow(session.id)).status).toBe("ready");
  });

  it("sets the session failed when the AI fails, and a retry can succeed", async () => {
    const { session } = await setup("rb-fail@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await buildRevisionSession(session.id, {
      generateVariant: async () => {
        throw new Error("boom");
      },
    });

    expect((await sessionRow(session.id)).status).toBe("failed");
    expect(await itemsOf(session.id)).toEqual([]);

    await db
      .update(revisionSessions)
      .set({ status: "building" })
      .where(eq(revisionSessions.id, session.id));
    await buildRevisionSession(session.id, okIo);
    expect((await sessionRow(session.id)).status).toBe("ready");
  });

  it("leaves a spot-the-error session alone: it is built by its own job", async () => {
    const { session } = await setup("rv-spot@test.local");
    await db
      .update(revisionSessions)
      .set({ mode: "spot_error", targetMinutes: null, questionCount: 5 })
      .where(eq(revisionSessions.id, session.id));
    const generateVariant = vi.fn(async () => variantAnswer);

    await buildRevisionSession(session.id, { generateVariant });

    expect(generateVariant).not.toHaveBeenCalled();
    expect((await sessionRow(session.id)).status).toBe("building");
    expect(await itemsOf(session.id)).toHaveLength(0);
  });

  it("ignores a session that is not building", async () => {
    const { session } = await setup("rb-ready@test.local");
    await db
      .update(revisionSessions)
      .set({ status: "ready" })
      .where(eq(revisionSessions.id, session.id));
    const generate = vi.fn(okIo.generateVariant);

    await buildRevisionSession(session.id, { generateVariant: generate });

    expect(generate).not.toHaveBeenCalled();
  });

  it("fails a session that has no candidates left", async () => {
    const { session, q1, q2 } = await setup("rb-empty@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.delete(marks);
    void q1;
    void q2;

    await buildRevisionSession(session.id, okIo);

    expect((await sessionRow(session.id)).status).toBe("failed");
  });
});
