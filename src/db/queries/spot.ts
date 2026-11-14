// Spot-the-error sessions, questions and answers (SPEC-spot-the-error.md).

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { listMisconceptions } from "@/db/queries/misconceptions";
import { NoCandidatesError } from "@/db/queries/revision";
import { revisionSessions, topics } from "@/db/schema";
import { NotFoundError, requireCourse } from "@/lib/auth/ownership";
import { rankMisconceptions } from "@/lib/spot/rules";

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
