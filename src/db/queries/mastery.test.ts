import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  questionTopics,
  revisionSessions,
  sheets,
  topicPrereqs,
  topics,
  users,
} from "@/db/schema";

import { getCourseEvents, getCourseMastery } from "./mastery";

const DAY = 24 * 60 * 60 * 1000;

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [algebra, groups] = await db
    .insert(topics)
    .values([
      { courseId: course.id, name: "Algebra" },
      { courseId: course.id, name: "Groups" },
    ])
    .returning();
  const [child] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Subgroups", parentId: groups.id })
    .returning();
  await db.insert(topicPrereqs).values({ topicId: groups.id, prereqId: algebra.id });
  const [question] = await db
    .insert(questions)
    .values({ courseId: course.id, position: 1, label: "1", body: "B", expectedMinutes: 10 })
    .returning();
  await db.insert(questionTopics).values({ questionId: question.id, topicId: algebra.id });
  return { user, course, algebra, groups, child, question };
}

async function attemptWithMark(
  userId: string,
  questionId: string,
  outcome: "full" | "partial" | "stuck",
  basis: "ai" | "official" = "ai",
  daysAgo = 1,
) {
  const [attempt] = await db
    .insert(attempts)
    .values({
      userId,
      questionId,
      context: "sheet",
      startedAt: new Date(Date.now() - daysAgo * DAY),
      secondsSpent: 300,
    })
    .returning();
  await db.insert(marks).values({
    attemptId: attempt.id,
    basis,
    score: outcome === "full" ? 5 : outcome === "partial" ? 3 : 0,
    outcome,
    feedback: "f",
    overallFeedback: "o",
  });
  return attempt;
}

describe("getCourseMastery", () => {
  it("returns every topic with null mastery when nothing was attempted", async () => {
    const { user, course, groups, child } = await setup("m-empty@test.local");

    const result = await getCourseMastery(user.id, course.id);

    expect(result.topics).toHaveLength(3);
    expect(result.topics.every((t) => t.mastery === null && t.attempts === 0)).toBe(true);
    expect(result.topics.find((t) => t.id === child.id)?.parentId).toBe(groups.id);
    expect(result.prereqs).toEqual([
      { topicId: groups.id, prereqId: result.topics.find((t) => t.name === "Algebra")!.id },
    ]);
  });

  it("scores only the topics a question is tagged with", async () => {
    const { user, course, algebra, groups, question } = await setup("m-score@test.local");
    await attemptWithMark(user.id, question.id, "full");

    const result = await getCourseMastery(user.id, course.id);
    const a = result.topics.find((t) => t.id === algebra.id)!;

    expect(a.attempts).toBe(1);
    expect(a.mastery).toBeGreaterThan(0.5);
    expect(a.series).toHaveLength(1);
    expect(result.topics.find((t) => t.id === groups.id)!.mastery).toBeNull();
  });

  it("ignores another user's attempts on the same question", async () => {
    const { user, course, algebra, question } = await setup("m-own@test.local");
    const [other] = await db.insert(users).values({ email: "m-own-other@test.local" }).returning();
    await attemptWithMark(other.id, question.id, "full");

    const result = await getCourseMastery(user.id, course.id);

    expect(result.topics.find((t) => t.id === algebra.id)!.mastery).toBeNull();
  });

  it("moves mastery further for an official mark than for a provisional one", async () => {
    const a = await setup("m-official@test.local");
    const b = await setup("m-provisional@test.local");
    await attemptWithMark(a.user.id, a.question.id, "full", "official");
    await attemptWithMark(b.user.id, b.question.id, "full", "ai");

    const official = (await getCourseMastery(a.user.id, a.course.id)).topics.find(
      (t) => t.id === a.algebra.id,
    )!;
    const provisional = (await getCourseMastery(b.user.id, b.course.id)).topics.find(
      (t) => t.id === b.algebra.id,
    )!;

    expect(official.mastery! - 0.5).toBeCloseTo(2 * (provisional.mastery! - 0.5), 5);
  });

  it("uses the current mark: an official mark replaces the AI mark of the same attempt", async () => {
    const { user, course, algebra, question } = await setup("m-current@test.local");
    const attempt = await attemptWithMark(user.id, question.id, "full", "ai");
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: "official",
      score: 0,
      outcome: "stuck",
      feedback: "f",
      overallFeedback: "o",
    });

    const t = (await getCourseMastery(user.id, course.id)).topics.find((x) => x.id === algebra.id)!;

    expect(t.attempts).toBe(1);
    expect(t.mastery).toBeLessThan(0.5);
  });

  it("skips attempts without a mark and counts variant questions", async () => {
    const { user, course, algebra, question } = await setup("m-variant@test.local");
    await db
      .insert(attempts)
      .values({ userId: user.id, questionId: question.id, context: "sheet" });
    const [variant] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        position: 0,
        label: "v",
        body: "V",
        expectedMinutes: 5,
        source: "variant",
        parentQuestionId: question.id,
      })
      .returning();
    await db.insert(questionTopics).values({ questionId: variant.id, topicId: algebra.id });
    await attemptWithMark(user.id, variant.id, "partial");

    const t = (await getCourseMastery(user.id, course.id)).topics.find((x) => x.id === algebra.id)!;

    expect(t.attempts).toBe(1);
  });

  it("gives nothing for another user's course", async () => {
    const a = await setup("m-x1@test.local");
    const b = await setup("m-x2@test.local");

    const result = await getCourseMastery(b.user.id, a.course.id);

    expect(result.topics).toEqual([]);
    expect(result.prereqs).toEqual([]);
  });
});

describe("getCourseEvents", () => {
  it("lists sheet uploads and ready revision sessions of the user's course only", async () => {
    const a = await setup("ev-a@test.local");
    const b = await setup("ev-b@test.local");
    await db.insert(sheets).values([
      {
        courseId: a.course.id,
        title: "Sheet 1",
        status: "ready",
        uploadedAt: new Date(Date.now() - 3 * DAY),
      },
      { courseId: b.course.id, title: "Other", status: "ready" },
    ]);
    await db.insert(revisionSessions).values([
      {
        userId: a.user.id,
        courseId: a.course.id,
        targetMinutes: 20,
        status: "ready",
        createdAt: new Date(Date.now() - DAY),
      },
      { userId: a.user.id, courseId: a.course.id, targetMinutes: 45, status: "failed" },
    ]);

    const events = await getCourseEvents(a.user.id, a.course.id);

    expect(events.map((e) => [e.kind, e.label])).toEqual([
      ["sheet", "Sheet 1"],
      ["revision", "Revision, 20 min"],
    ]);
    expect(await getCourseEvents(b.user.id, a.course.id)).toEqual([]);
  });
});
