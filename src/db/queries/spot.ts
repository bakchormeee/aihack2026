// Spot-the-error sessions, questions and answers (SPEC-spot-the-error.md).

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { listMisconceptions } from "@/db/queries/misconceptions";
import { NoCandidatesError } from "@/db/queries/revision";
import { misconceptions, revisionSessions, spotAnswers, spotItems, topics } from "@/db/schema";
import { NotFoundError, requireCourse, requireRevisionSession } from "@/lib/auth/ownership";
import type { Outcome, SpotJudgement, SpotTick } from "@/lib/domain";
import { missedMisconceptions, rankMisconceptions } from "@/lib/spot/rules";

/** The student's misconceptions as the ranking rules want them. */
export async function rankedMisconceptionsFor(
  userId: string,
  courseId: string,
  topicIds: string[] | null,
) {
  const views = await listMisconceptions(userId, courseId);
  const ranked = rankMisconceptions(
    views.map((v) => ({
      id: v.id,
      timesSeen: v.timesSeen,
      lastSeen: v.lastSeen ?? new Date(0),
      topicIds: v.topicIds,
      hidden: v.hidden,
    })),
    topicIds,
  );
  const byId = new Map(views.map((v) => [v.id, v]));
  return ranked.map((r) => byId.get(r.id)!);
}

/** Creates a spot-the-error session in `building`. Throws NoCandidatesError when there is nothing to plant. */
export async function createSpotSession(
  userId: string,
  i: { courseId: string; questionCount: number; topicIds: string[] | null },
) {
  await requireCourse(userId, i.courseId);
  const topicIds = i.topicIds && i.topicIds.length > 0 ? [...new Set(i.topicIds)] : null;
  if (topicIds) {
    const owned = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.courseId, i.courseId), inArray(topics.id, topicIds)));
    if (owned.length !== topicIds.length) throw new NotFoundError();
  }
  if ((await rankedMisconceptionsFor(userId, i.courseId, topicIds)).length === 0)
    throw new NoCandidatesError();

  const [session] = await db
    .insert(revisionSessions)
    .values({
      userId,
      courseId: i.courseId,
      mode: "spot_error",
      questionCount: i.questionCount,
      targetMinutes: null,
      topicIds,
    })
    .returning();
  return session;
}

/** One question of a spot-the-error session of the user's, with their answer row if they have opened it. */
export async function loadSpotItem(userId: string, sessionId: string, position: number) {
  const session = await requireRevisionSession(userId, sessionId);
  if (session.mode !== "spot_error") throw new NotFoundError();
  const [item] = await db
    .select()
    .from(spotItems)
    .where(and(eq(spotItems.sessionId, sessionId), eq(spotItems.position, position)));
  if (!item) throw new NotFoundError();
  const [answer] = await db.select().from(spotAnswers).where(eq(spotAnswers.itemId, item.id));
  return { session, item, answer: answer ?? null };
}

/** Records that the student has opened the question; the clock for time spent starts here. */
export async function startSpotAnswer(userId: string, itemId: string): Promise<void> {
  await db.insert(spotAnswers).values({ itemId, userId }).onConflictDoNothing();
}

/**
 * Takes the student's one answer: saves their lines and explanations and the time spent.
 * Returns false when the question was already answered, so a double submit changes nothing.
 */
export async function claimSpotAnswer(
  itemId: string,
  a: { noError: boolean; ticked: SpotTick[] },
  now: Date,
): Promise<boolean> {
  const [row] = await db.select().from(spotAnswers).where(eq(spotAnswers.itemId, itemId));
  if (!row) return false;
  const claimed = await db
    .update(spotAnswers)
    .set({
      answeredAt: now,
      secondsSpent: Math.max(0, Math.round((now.getTime() - row.startedAt.getTime()) / 1000)),
      noError: a.noError,
      ticked: a.ticked,
    })
    .where(and(eq(spotAnswers.itemId, itemId), isNull(spotAnswers.answeredAt)))
    .returning({ itemId: spotAnswers.itemId });
  return claimed.length > 0;
}

/** Saves the AI's verdicts and the outcome that follows from them. */
export async function finishSpotAnswer(
  itemId: string,
  judgements: SpotJudgement[],
  outcome: Outcome,
): Promise<void> {
  await db.update(spotAnswers).set({ judgements, outcome }).where(eq(spotAnswers.itemId, itemId));
}

/** Gives the answer back (the AI failed), so the student can submit again. */
export async function releaseSpotAnswer(itemId: string): Promise<void> {
  await db
    .update(spotAnswers)
    .set({ answeredAt: null, secondsSpent: null, noError: false, ticked: [], judgements: [] })
    .where(eq(spotAnswers.itemId, itemId));
}

/** The descriptions of misconceptions, by id (hidden ones included: a planted one may be hidden later). */
export async function misconceptionDescriptions(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: misconceptions.id, description: misconceptions.description })
    .from(misconceptions)
    .where(inArray(misconceptions.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.description]));
}

/**
 * A spot-the-error session of the user's with its questions in order and how each was
 * answered, and, once every question is answered, the common errors they missed.
 */
export async function getSpotSession(userId: string, sessionId: string) {
  const session = await requireRevisionSession(userId, sessionId);
  if (session.mode !== "spot_error") throw new NotFoundError();
  const rows = await db
    .select({ item: spotItems, answer: spotAnswers })
    .from(spotItems)
    .leftJoin(spotAnswers, eq(spotAnswers.itemId, spotItems.id))
    .where(eq(spotItems.sessionId, sessionId))
    .orderBy(spotItems.position);

  const items = rows.map(({ item, answer }) => ({
    position: item.position,
    answered: answer?.answeredAt != null,
    outcome: answer?.outcome ?? null,
  }));

  const missedIds = rows.flatMap(({ item, answer }) =>
    answer?.answeredAt != null
      ? missedMisconceptions(
          item.planted,
          answer.ticked.map((t) => t.line),
          Object.fromEntries(answer.judgements.map((j) => [j.line, j.right])),
        )
      : [],
  );
  const descriptions = await misconceptionDescriptions(missedIds);
  const counts = { full: 0, partial: 0, stuck: 0 };
  for (const item of items) if (item.outcome) counts[item.outcome]++;
  return {
    session,
    items,
    done: items.length > 0 && items.every((i) => i.answered),
    counts,
    missed: [...new Set(missedIds)].map((id) => descriptions.get(id)!).filter(Boolean),
  };
}
