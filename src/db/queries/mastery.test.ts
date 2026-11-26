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
  submissions,
  spotAnswers,
  spotItems,
  topicPrereqs,
  topics,
  users,
} from "@/db/schema";

import { binSheet, restoreSheet } from "./bin";
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

  it("does not count a submission that is waiting for the official solutions", async () => {
    const { user, course, algebra, question } = await setup("m-waiting@test.local");
    await attemptWithMark(user.id, question.id, "partial", "ai", 3);
    const before = (await getCourseMastery(user.id, course.id)).topics.find(
      (t) => t.id === algebra.id,
    )!;
    const [later] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: question.id, context: "sheet" })
      .returning();
    await db.insert(submissions).values({
      attemptId: later.id,
      text: "x",
      submittedAt: new Date(),
      markStatus: "awaiting_official",
    });

    const after = (await getCourseMastery(user.id, course.id)).topics.find(
      (t) => t.id === algebra.id,
    )!;

    expect(after.attempts).toBe(before.attempts);
    expect(after.mastery).toBe(before.mastery);
    expect(after.series).toEqual(before.series);
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

  it("gives each tried topic a review schedule from its marks, and none to an untried one", async () => {
    const { user, course, algebra, groups, question } = await setup("m-review@test.local");
    await attemptWithMark(user.id, question.id, "full", "ai", 2);

    const all = (await getCourseMastery(user.id, course.id)).topics;
    const tried = all.find((t) => t.id === algebra.id)!;

    // Full, no hints, on time: Easy, so the first interval is 4 days.
    expect(tried.review).toMatchObject({ interval: 4, reviews: 1, daysUntilDue: 2 });
    expect(all.find((t) => t.id === groups.id)!.review).toBeNull();
  });

  it("changes the schedule when a new mark replaces the old one", async () => {
    const { user, course, algebra, question } = await setup("m-review-remark@test.local");
    const attempt = await attemptWithMark(user.id, question.id, "full", "ai", 2);
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: "official",
      score: 0,
      outcome: "stuck",
      feedback: "f",
      overallFeedback: "o",
    });

    const t = (await getCourseMastery(user.id, course.id)).topics.find((x) => x.id === algebra.id)!;

    // Stuck: Again, so it was due the day after.
    expect(t.review).toMatchObject({ interval: 1, daysUntilDue: -1 });
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

describe("getCourseMastery with spot-the-error answers", () => {
  async function spotAnswer(
    w: Awaited<ReturnType<typeof setup>>,
    o: { topicIds: string[]; outcome: "full" | "partial" | "stuck" | null; answered?: boolean },
  ) {
    const [session] = await db
      .insert(revisionSessions)
      .values({
        userId: w.user.id,
        courseId: w.course.id,
        mode: "spot_error",
        questionCount: 5,
        status: "ready",
      })
      .returning();
    const [item] = await db
      .insert(spotItems)
      .values({
        sessionId: session.id,
        position: 1,
        body: "Q",
        lines: ["a", "b", "c"],
        planted: [],
        topicIds: o.topicIds,
      })
      .returning();
    await db.insert(spotAnswers).values({
      itemId: item.id,
      userId: w.user.id,
      answeredAt: o.answered === false ? null : new Date(Date.now() - DAY),
      outcome: o.outcome,
    });
  }

  it("counts a correct answer on the question's topics at weight 0.25", async () => {
    const w = await setup("ms-spot@test.local");
    await spotAnswer(w, { topicIds: [w.algebra.id, w.groups.id], outcome: "full" });

    const result = await getCourseMastery(w.user.id, w.course.id);

    for (const id of [w.algebra.id, w.groups.id]) {
      const topic = result.topics.find((t) => t.id === id)!;
      expect(topic.mastery).toBeCloseTo(0.5 + 0.3 * 0.25 * (1 - 0.5));
      expect(topic.attempts).toBe(1);
    }
    expect(result.topics.find((t) => t.id === w.child.id)!.mastery).toBeNull();
  });

  it("moves mastery down for a stuck answer and by half for a partly right one", async () => {
    const stuck = await setup("ms-spot-stuck@test.local");
    await spotAnswer(stuck, { topicIds: [stuck.algebra.id], outcome: "stuck" });
    const partial = await setup("ms-spot-partial@test.local");
    await spotAnswer(partial, { topicIds: [partial.algebra.id], outcome: "partial" });

    const down = (await getCourseMastery(stuck.user.id, stuck.course.id)).topics.find(
      (t) => t.id === stuck.algebra.id,
    )!;
    const same = (await getCourseMastery(partial.user.id, partial.course.id)).topics.find(
      (t) => t.id === partial.algebra.id,
    )!;
    expect(down.mastery).toBeCloseTo(0.5 + 0.3 * 0.25 * (0 - 0.5));
    expect(same.mastery).toBeCloseTo(0.5); // evidence 0.5 from a start of 0.5
  });

  it("ignores an unanswered or still-judging question and topics of another course", async () => {
    const w = await setup("ms-spot-ignore@test.local");
    const other = await setup("ms-spot-other@test.local");
    await spotAnswer(w, { topicIds: [w.algebra.id], outcome: "full", answered: false });
    await spotAnswer(w, { topicIds: [w.algebra.id], outcome: null });
    await spotAnswer(w, { topicIds: [other.algebra.id], outcome: "full" });

    const result = await getCourseMastery(w.user.id, w.course.id);

    expect(result.topics.every((t) => t.mastery === null)).toBe(true);
  });

  it("leaves the mastery of long-form attempts unchanged when there are no spot answers", async () => {
    const w = await setup("ms-spot-none@test.local");
    await attemptWithMark(w.user.id, w.question.id, "full");

    const topic = (await getCourseMastery(w.user.id, w.course.id)).topics.find(
      (t) => t.id === w.algebra.id,
    )!;

    expect(topic.mastery).toBeCloseTo(0.5 + 0.3 * 0.5 * (1 - 0.5));
  });

  it("adds a spot answer after a long-form attempt in time order", async () => {
    const w = await setup("ms-spot-order@test.local");
    await attemptWithMark(w.user.id, w.question.id, "full", "ai", 5);
    await spotAnswer(w, { topicIds: [w.algebra.id], outcome: "stuck" });

    const topic = (await getCourseMastery(w.user.id, w.course.id)).topics.find(
      (t) => t.id === w.algebra.id,
    )!;

    const afterFirst = 0.5 + 0.3 * 0.5 * (1 - 0.5);
    expect(topic.mastery).toBeCloseTo(afterFirst + 0.3 * 0.25 * (0 - afterFirst));
    expect(topic.attempts).toBe(2);
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
      {
        userId: a.user.id,
        courseId: a.course.id,
        mode: "spot_error",
        questionCount: 10,
        status: "ready",
        createdAt: new Date(Date.now() - DAY / 2),
      },
    ]);

    const events = await getCourseEvents(a.user.id, a.course.id);

    expect(events.map((e) => [e.kind, e.label])).toEqual([
      ["sheet", "Sheet 1"],
      ["revision", "Revision, 20 min"],
      ["revision", "Spot the error, 10 questions"],
    ]);
    expect(await getCourseEvents(b.user.id, a.course.id)).toEqual([]);
  });
});

describe("mastery, the progress chart and the bin", () => {
  it("leaves out attempts on a binned sheet and its variants, and gives them back on restore", async () => {
    const w = await setup("m-bin@test.local");
    const [sheet] = await db
      .insert(sheets)
      .values({ courseId: w.course.id, title: "Binned", status: "ready" })
      .returning();
    const [onSheet] = await db
      .insert(questions)
      .values({
        courseId: w.course.id,
        sheetId: sheet.id,
        position: 1,
        label: "S1",
        body: "B",
        expectedMinutes: 10,
      })
      .returning();
    const [variant] = await db
      .insert(questions)
      .values({
        courseId: w.course.id,
        position: 1,
        label: "S1 (variant)",
        body: "V",
        expectedMinutes: 10,
        source: "variant",
        parentQuestionId: onSheet.id,
      })
      .returning();
    await db.insert(questionTopics).values([
      { questionId: onSheet.id, topicId: w.algebra.id },
      { questionId: variant.id, topicId: w.algebra.id },
    ]);
    await attemptWithMark(w.user.id, w.question.id, "stuck", "ai", 3);
    await attemptWithMark(w.user.id, onSheet.id, "full", "ai", 2);
    await attemptWithMark(w.user.id, variant.id, "full", "ai", 1);

    const algebra = async () =>
      (await getCourseMastery(w.user.id, w.course.id)).topics.find((t) => t.id === w.algebra.id)!;
    const eventTitles = async () =>
      (await getCourseEvents(w.user.id, w.course.id)).map((e) => e.label);
    const before = await algebra();
    expect(before.attempts).toBe(3);
    expect(await eventTitles()).toEqual(["Binned"]);

    await binSheet(w.user.id, sheet.id);
    const binned = await algebra();
    expect(binned.attempts).toBe(1);
    expect(binned.series).toHaveLength(1);
    expect(binned.mastery).toBeLessThan(before.mastery!);
    // The review date moves back to the last attempt that still counts.
    expect(binned.review!.lastDay).toBeLessThan(before.review!.lastDay);
    expect(await eventTitles()).toEqual([]);

    await restoreSheet(w.user.id, sheet.id);
    const restored = await algebra();
    expect(restored.attempts).toBe(3);
    expect(restored.mastery).toBeCloseTo(before.mastery!);
    expect(await eventTitles()).toEqual(["Binned"]);
  });
});
