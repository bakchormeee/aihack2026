// Revision sessions: choosing what to revise and showing a session (tasks V2, V3).

import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  revisionItems,
  revisionSessions,
  submissions,
  topics,
} from "@/db/schema";
import { requireCourse, requireRevisionSession, NotFoundError } from "@/lib/auth/ownership";
import { STALE_JOB_MS, type HintLevel } from "@/lib/domain";
import { attemptHintLevel, currentMark } from "@/lib/marking/rules";
import type { Candidate } from "@/lib/mastery/queue";

import { binnedQuestionIdsOf } from "./bin";

export class NoCandidatesError extends Error {
  constructor() {
    super("Nothing to revise yet");
    this.name = "NoCandidatesError";
  }
}

/**
 * Original questions worth retrying: the newest attempt that has a current mark
 * was not full, or was full with hint level 2 or 3. Only the user's own attempts
 * count. With `topicIds`, only questions tagged with one of them. Questions in
 * the bin are left out.
 */
export async function listRetryCandidates(
  userId: string,
  courseId: string,
  topicIds?: string[] | null,
): Promise<Candidate[]> {
  const binned = await binnedQuestionIdsOf(courseId);
  const allRows = await db
    .select({
      attemptId: attempts.id,
      questionId: questions.id,
      label: questions.label,
      expectedMinutes: questions.expectedMinutes,
      startedAt: attempts.startedAt,
      inherited: attempts.inheritedHintLevel,
    })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(questions.courseId, courseId),
        eq(questions.source, "original"),
      ),
    );
  const rows = allRows.filter((r) => !binned.has(r.questionId));
  if (rows.length === 0) return [];

  const attemptIds = rows.map((r) => r.attemptId);
  const markRows = await db.select().from(marks).where(inArray(marks.attemptId, attemptIds));
  const revealRows = await db
    .select({ attemptId: hintReveals.attemptId, level: hints.level })
    .from(hintReveals)
    .innerJoin(hints, eq(hintReveals.hintId, hints.id))
    .where(inArray(hintReveals.attemptId, attemptIds));
  const topicRows = await db
    .select({ questionId: questionTopics.questionId, topicId: questionTopics.topicId })
    .from(questionTopics)
    .where(inArray(questionTopics.questionId, [...new Set(rows.map((r) => r.questionId))]));

  const topicsOf = new Map<string, string[]>();
  for (const t of topicRows)
    topicsOf.set(t.questionId, [...(topicsOf.get(t.questionId) ?? []), t.topicId]);

  // Newest first, keeping only attempts that have a current mark.
  const marked = rows
    .map((r) => ({
      ...r,
      mark: currentMark(markRows.filter((m) => m.attemptId === r.attemptId)),
      hintLevel: attemptHintLevel(
        r.inherited as HintLevel,
        revealRows.filter((x) => x.attemptId === r.attemptId).map((x) => x.level),
      ),
    }))
    .filter((r) => r.mark !== null)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const byQuestion = new Map<string, typeof marked>();
  for (const r of marked)
    byQuestion.set(r.questionId, [...(byQuestion.get(r.questionId) ?? []), r]);

  const wanted = topicIds && topicIds.length > 0 ? new Set(topicIds) : null;
  const result: Candidate[] = [];
  for (const [questionId, list] of byQuestion) {
    const newest = list[0];
    const outcome = newest.mark!.outcome;
    if (outcome === "full" && newest.hintLevel < 2) continue;
    const qTopics = topicsOf.get(questionId) ?? [];
    if (wanted && !qTopics.some((t) => wanted.has(t))) continue;
    result.push({
      questionId,
      topicIds: qTopics,
      expectedMinutes: newest.expectedMinutes,
      lastAttemptAt: newest.startedAt,
      lastOutcome: outcome,
      lastHintLevel: newest.hintLevel,
      label: newest.label,
    });
  }
  return result;
}

/** Creates a session in `building`. Throws NoCandidatesError when there is nothing to revise. */
export async function createRevisionSession(
  userId: string,
  i: { courseId: string; targetMinutes: number; topicIds: string[] | null },
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
  if ((await listRetryCandidates(userId, i.courseId, topicIds)).length === 0) {
    throw new NoCandidatesError();
  }
  const [session] = await db
    .insert(revisionSessions)
    .values({ userId, courseId: i.courseId, targetMinutes: i.targetMinutes, topicIds })
    .returning();
  return session;
}

/**
 * A session with its items in order. An item is done once the user submitted an attempt
 * of it in this session. Items on binned questions are left out; `allDeleted` is true
 * when the session had items and every one of them is in the bin.
 */
export async function getRevisionSession(userId: string, sessionId: string) {
  const session = await requireRevisionSession(userId, sessionId);
  const binned = await binnedQuestionIdsOf(session.courseId);
  const allItems = await db
    .select({
      position: revisionItems.position,
      questionId: revisionItems.questionId,
      source: revisionItems.source,
      reason: revisionItems.reason,
      label: questions.label,
      body: questions.body,
      expectedMinutes: questions.expectedMinutes,
    })
    .from(revisionItems)
    .innerJoin(questions, eq(revisionItems.questionId, questions.id))
    .where(eq(revisionItems.sessionId, sessionId))
    .orderBy(asc(revisionItems.position));
  const items = allItems.filter((item) => !binned.has(item.questionId));

  const submitted = await db
    .select({ questionId: attempts.questionId })
    .from(attempts)
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.revisionSessionId, sessionId),
        isNotNull(submissions.submittedAt),
      ),
    );
  const doneIds = new Set(submitted.map((s) => s.questionId));
  return {
    session,
    items: items.map((item) => ({ ...item, done: doneIds.has(item.questionId) })),
    allDeleted: allItems.length > 0 && items.length === 0,
  };
}

/** Puts a failed or stale `building` session back to `building`. True when this call did it. */
export async function requeueRevisionSession(userId: string, sessionId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  const rows = await db
    .update(revisionSessions)
    .set({ status: "building", statusUpdatedAt: new Date() })
    .where(
      and(
        eq(revisionSessions.id, sessionId),
        eq(revisionSessions.userId, userId),
        or(
          eq(revisionSessions.status, "failed"),
          and(
            eq(revisionSessions.status, "building"),
            sql`${revisionSessions.statusUpdatedAt} < ${staleBefore}`,
          ),
        ),
      ),
    )
    .returning({ id: revisionSessions.id });
  return rows.length > 0;
}
