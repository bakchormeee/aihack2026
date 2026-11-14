import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  revisionItems,
  revisionSessions,
  submissions,
  topics,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  createRevisionSession,
  getRevisionSession,
  listRetryCandidates,
  NoCandidatesError,
  requeueRevisionSession,
} from "./revision";

const DAY = 24 * 60 * 60 * 1000;

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [t1, t2] = await db
    .insert(topics)
    .values([
      { courseId: course.id, name: "Limits" },
      { courseId: course.id, name: "Series" },
    ])
    .returning();
  return { user, course, t1, t2 };
}

async function question(
  courseId: string,
  topicIds: string[],
  o: { position?: number; source?: "original" | "variant" } = {},
) {
  const [q] = await db
    .insert(questions)
    .values({
      courseId,
      position: o.position ?? 1,
      label: `Q${o.position ?? 1}`,
      body: "B",
      expectedMinutes: 10,
      source: o.source ?? "original",
      hintsStatus: "ready",
    })
    .returning();
  if (topicIds.length)
    await db
      .insert(questionTopics)
      .values(topicIds.map((topicId) => ({ questionId: q.id, topicId })));
  return q;
}

async function attempt(
  userId: string,
  questionId: string,
  outcome: "full" | "partial" | "stuck" | null,
  daysAgo: number,
  hintLevel = 0,
) {
  const [a] = await db
    .insert(attempts)
    .values({
      userId,
      questionId,
      context: "sheet",
      startedAt: new Date(Date.now() - daysAgo * DAY),
      inheritedHintLevel: hintLevel,
    })
    .returning();
  if (outcome)
    await db.insert(marks).values({
      attemptId: a.id,
      basis: "ai",
      score: outcome === "full" ? 100 : outcome === "partial" ? 50 : 0,
      outcome,
      feedback: "f",
      overallFeedback: "o",
    });
  return a;
}

describe("listRetryCandidates", () => {
  it("includes questions whose newest marked attempt is not full", async () => {
    const { user, course, t1 } = await setup("rv-notfull@test.local");
    const q = await question(course.id, [t1.id]);
    await attempt(user.id, q.id, "full", 5);
    await attempt(user.id, q.id, "partial", 1);

    const c = await listRetryCandidates(user.id, course.id);

    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      questionId: q.id,
      topicIds: [t1.id],
      lastOutcome: "partial",
      lastHintLevel: 0,
      consecutiveFull: 0,
      expectedMinutes: 10,
      label: "Q1",
    });
  });

  it("includes a full attempt that used hint 2 or 3, excludes full with 0 or 1 hints", async () => {
    const { user, course, t1 } = await setup("rv-hints@test.local");
    const q2 = await question(course.id, [t1.id], { position: 1 });
    const q3 = await question(course.id, [t1.id], { position: 2 });
    const q0 = await question(course.id, [t1.id], { position: 3 });
    const q1 = await question(course.id, [t1.id], { position: 4 });
    await attempt(user.id, q2.id, "full", 2, 2);
    await attempt(user.id, q3.id, "full", 2, 3);
    await attempt(user.id, q0.id, "full", 2, 0);
    await attempt(user.id, q1.id, "full", 2, 1);

    const ids = (await listRetryCandidates(user.id, course.id)).map((c) => c.questionId).sort();

    expect(ids).toEqual([q2.id, q3.id].sort());
  });

  it("counts a revealed hint towards the hint level", async () => {
    const { user, course, t1 } = await setup("rv-reveal@test.local");
    const q = await question(course.id, [t1.id]);
    const [h] = await db
      .insert(hints)
      .values({ questionId: q.id, level: 3, body: "h" })
      .returning();
    const a = await attempt(user.id, q.id, "full", 2);
    await db.insert(hintReveals).values({ attemptId: a.id, hintId: h.id });

    const c = await listRetryCandidates(user.id, course.id);

    expect(c[0].lastHintLevel).toBe(3);
  });

  it("counts consecutive full attempts and ignores unmarked attempts", async () => {
    const { user, course, t1 } = await setup("rv-consec@test.local");
    const q = await question(course.id, [t1.id]);
    await attempt(user.id, q.id, "partial", 10);
    await attempt(user.id, q.id, "full", 6, 3);
    await attempt(user.id, q.id, "full", 4, 2);
    await attempt(user.id, q.id, null, 1);

    const c = await listRetryCandidates(user.id, course.id);

    expect(c[0].consecutiveFull).toBe(2);
    expect(c[0].lastAttemptAt.getTime()).toBeCloseTo(Date.now() - 4 * DAY, -4);
  });

  it("excludes variants, unmarked questions and other users", async () => {
    const { user, course, t1 } = await setup("rv-excl@test.local");
    const other = await setup("rv-excl-other@test.local");
    const variant = await question(course.id, [t1.id], { source: "variant", position: 2 });
    const unmarked = await question(course.id, [t1.id], { position: 3 });
    const shared = await question(course.id, [t1.id], { position: 4 });
    await attempt(user.id, variant.id, "stuck", 1);
    await attempt(user.id, unmarked.id, null, 1);
    await attempt(other.user.id, shared.id, "stuck", 1);

    expect(await listRetryCandidates(user.id, course.id)).toEqual([]);
    expect(await listRetryCandidates(other.user.id, other.course.id)).toEqual([]);
  });

  it("filters by topic", async () => {
    const { user, course, t1, t2 } = await setup("rv-topic@test.local");
    const a = await question(course.id, [t1.id], { position: 1 });
    const b = await question(course.id, [t2.id], { position: 2 });
    await attempt(user.id, a.id, "stuck", 1);
    await attempt(user.id, b.id, "stuck", 1);

    const c = await listRetryCandidates(user.id, course.id, [t2.id]);

    expect(c.map((x) => x.questionId)).toEqual([b.id]);
  });
});

describe("createRevisionSession", () => {
  it("inserts a building session", async () => {
    const { user, course, t1 } = await setup("rv-create@test.local");
    const q = await question(course.id, [t1.id]);
    await attempt(user.id, q.id, "stuck", 1);

    const session = await createRevisionSession(user.id, {
      courseId: course.id,
      targetMinutes: 20,
      topicIds: [t1.id],
    });

    expect(session).toMatchObject({ status: "building", targetMinutes: 20, userId: user.id });
    expect(session.topicIds).toEqual([t1.id]);
  });

  it("refuses a course with no candidates", async () => {
    const { user, course } = await setup("rv-none@test.local");

    await expect(
      createRevisionSession(user.id, { courseId: course.id, targetMinutes: 20, topicIds: null }),
    ).rejects.toBeInstanceOf(NoCandidatesError);
    expect(await db.select().from(revisionSessions)).not.toContainEqual(
      expect.objectContaining({ courseId: course.id }),
    );
  });

  it("refuses another user's course and topics of another course", async () => {
    const a = await setup("rv-own-a@test.local");
    const b = await setup("rv-own-b@test.local");
    const q = await question(a.course.id, [a.t1.id]);
    await attempt(a.user.id, q.id, "stuck", 1);

    await expect(
      createRevisionSession(b.user.id, {
        courseId: a.course.id,
        targetMinutes: 20,
        topicIds: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      createRevisionSession(a.user.id, {
        courseId: a.course.id,
        targetMinutes: 20,
        topicIds: [b.t1.id],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getRevisionSession and requeue", () => {
  it("lists items in order with done flags, only for the owner", async () => {
    const { user, course, t1 } = await setup("rv-get@test.local");
    const other = await setup("rv-get-other@test.local");
    const q1 = await question(course.id, [t1.id], { position: 1 });
    const q2 = await question(course.id, [t1.id], { position: 2 });
    const [s] = await db
      .insert(revisionSessions)
      .values({ userId: user.id, courseId: course.id, targetMinutes: 20, status: "ready" })
      .returning();
    await db.insert(revisionItems).values([
      { sessionId: s.id, questionId: q2.id, position: 2, source: "variant", reason: "r2" },
      { sessionId: s.id, questionId: q1.id, position: 1, source: "retry", reason: "r1" },
    ]);
    const [done] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: q1.id, context: "revision", revisionSessionId: s.id })
      .returning();
    await db.insert(submissions).values({ attemptId: done.id, submittedAt: new Date() });
    // A draft in this session does not count as done.
    const [draft] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: q2.id, context: "revision", revisionSessionId: s.id })
      .returning();
    await db.insert(submissions).values({ attemptId: draft.id, submittedAt: null });

    const view = await getRevisionSession(user.id, s.id);

    expect(view.items.map((i) => [i.questionId, i.reason, i.done])).toEqual([
      [q1.id, "r1", true],
      [q2.id, "r2", false],
    ]);
    await expect(getRevisionSession(other.user.id, s.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("requeues only failed or stale sessions, only for the owner", async () => {
    const { user, course } = await setup("rv-requeue@test.local");
    const other = await setup("rv-requeue-other@test.local");
    const mk = (status: "building" | "failed" | "ready", ageMs: number) =>
      db
        .insert(revisionSessions)
        .values({
          userId: user.id,
          courseId: course.id,
          targetMinutes: 20,
          status,
          statusUpdatedAt: new Date(Date.now() - ageMs),
        })
        .returning()
        .then((r) => r[0]);
    const failed = await mk("failed", 1000);
    const stale = await mk("building", 4 * 60 * 1000);
    const fresh = await mk("building", 1000);
    const ready = await mk("ready", 10 * 60 * 1000);

    expect(await requeueRevisionSession(other.user.id, failed.id)).toBe(false);
    expect(await requeueRevisionSession(user.id, failed.id)).toBe(true);
    expect(await requeueRevisionSession(user.id, stale.id)).toBe(true);
    expect(await requeueRevisionSession(user.id, fresh.id)).toBe(false);
    expect(await requeueRevisionSession(user.id, ready.id)).toBe(false);
    const row = (
      await db.select().from(revisionSessions).where(eq(revisionSessions.id, failed.id))
    )[0];
    expect(row.status).toBe("building");
  });
});
