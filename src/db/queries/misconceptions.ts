// The student's common errors per course (SPEC-spot-the-error.md). A misconception
// is stored; how often it was seen is computed on read from the CURRENT mark of each
// attempt, so a mark that a dispute or official re-mark replaced stops counting.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  marks,
  misconceptionJobs,
  misconceptionMarks,
  misconceptionSources,
  misconceptions,
  questionTopics,
  questions,
  topics,
} from "@/db/schema";
import { NotFoundError, requireCourse } from "@/lib/auth/ownership";
import { STALE_JOB_MS, type ErrorType } from "@/lib/domain";
import { currentMark } from "@/lib/marking/rules";
import { timesSeen } from "@/lib/spot/rules";

export type MisconceptionView = {
  id: string;
  description: string;
  errorType: ErrorType;
  hidden: boolean;
  timesSeen: number;
  lastSeen: Date | null;
  topicIds: string[];
  /** The student's own words at the most recent mistake behind it, or null when none counts now. */
  example: string | null;
};

type MarkRow = typeof marks.$inferSelect;

/** The current mark of each given attempt. */
async function currentMarks(attemptIds: string[]): Promise<Map<string, MarkRow>> {
  const result = new Map<string, MarkRow>();
  if (attemptIds.length === 0) return result;
  const rows = await db.select().from(marks).where(inArray(marks.attemptId, attemptIds));
  const byAttempt = new Map<string, MarkRow[]>();
  for (const row of rows)
    byAttempt.set(row.attemptId, [...(byAttempt.get(row.attemptId) ?? []), row]);
  for (const [attemptId, list] of byAttempt) result.set(attemptId, currentMark(list)!);
  return result;
}

/** Every misconception of the course, hidden ones included, most often seen first. */
export async function listMisconceptions(
  userId: string,
  courseId: string,
): Promise<MisconceptionView[]> {
  await requireCourse(userId, courseId);
  const rows = await db
    .select()
    .from(misconceptions)
    .where(and(eq(misconceptions.userId, userId), eq(misconceptions.courseId, courseId)));
  if (rows.length === 0) return [];

  const sources = await db
    .select()
    .from(misconceptionSources)
    .where(
      inArray(
        misconceptionSources.misconceptionId,
        rows.map((r) => r.id),
      ),
    );
  const current = await currentMarks([...new Set(sources.map((s) => s.attemptId))]);

  const views = rows.map((row): MisconceptionView => {
    const mine = sources.filter((s) => s.misconceptionId === row.id);
    const counting = mine.filter((s) => current.get(s.attemptId)?.id === s.markId);
    const newest = counting.reduce<(typeof counting)[number] | null>(
      (best, s) =>
        best === null ||
        current.get(s.attemptId)!.createdAt > current.get(best.attemptId)!.createdAt
          ? s
          : best,
      null,
    );
    return {
      id: row.id,
      description: row.description,
      errorType: row.errorType,
      hidden: row.hiddenAt !== null,
      timesSeen: timesSeen(
        mine,
        new Map([...current].map(([attemptId, mark]) => [attemptId, mark.id])),
      ),
      lastSeen: newest ? current.get(newest.attemptId)!.createdAt : null,
      topicIds: [...new Set(counting.flatMap((s) => s.topicIds))],
      example: newest?.quote ?? null,
    };
  });
  return views.sort(
    (a, b) =>
      b.timesSeen - a.timesSeen || (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0),
  );
}

/** "Not me": hides a misconception so it is never planted or shown. */
export async function hideMisconception(userId: string, misconceptionId: string): Promise<void> {
  const updated = await db
    .update(misconceptions)
    .set({ hiddenAt: new Date() })
    .where(and(eq(misconceptions.id, misconceptionId), eq(misconceptions.userId, userId)))
    .returning({ id: misconceptions.id });
  if (updated.length === 0) throw new NotFoundError();
}

export type UnreadMark = {
  mark: MarkRow;
  attemptId: string;
  topics: { id: string; name: string }[];
};

/** The current marks of the user's attempts in the course that the grouping job has not read yet. */
export async function findUnreadMarks(userId: string, courseId: string): Promise<UnreadMark[]> {
  const attemptRows = await db
    .select({ id: attempts.id, questionId: attempts.questionId })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .where(and(eq(attempts.userId, userId), eq(questions.courseId, courseId)));
  const current = await currentMarks(attemptRows.map((a) => a.id));
  if (current.size === 0) return [];

  const read = new Set(
    (
      await db
        .select({ markId: misconceptionMarks.markId })
        .from(misconceptionMarks)
        .where(
          inArray(
            misconceptionMarks.markId,
            [...current.values()].map((m) => m.id),
          ),
        )
    ).map((r) => r.markId),
  );

  const unread = attemptRows.filter((a) => current.has(a.id) && !read.has(current.get(a.id)!.id));
  if (unread.length === 0) return [];
  const topicRows = await db
    .select({ questionId: questionTopics.questionId, id: topics.id, name: topics.name })
    .from(questionTopics)
    .innerJoin(topics, eq(questionTopics.topicId, topics.id))
    .where(
      inArray(
        questionTopics.questionId,
        unread.map((a) => a.questionId),
      ),
    );
  return unread
    .map((a) => ({
      mark: current.get(a.id)!,
      attemptId: a.id,
      topics: topicRows
        .filter((t) => t.questionId === a.questionId)
        .map((t) => ({ id: t.id, name: t.name })),
    }))
    .sort((x, y) => x.mark.createdAt.getTime() - y.mark.createdAt.getTime());
}

/** Where the course's grouping job stands, or null if it never ran. */
export async function getMisconceptionJob(userId: string, courseId: string) {
  const [job] = await db
    .select()
    .from(misconceptionJobs)
    .where(and(eq(misconceptionJobs.userId, userId), eq(misconceptionJobs.courseId, courseId)));
  return job ?? null;
}

/** After a failed run, the next visit waits this long before trying again. */
const RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000;

/**
 * What the Revise page needs for a course: the misconceptions it may show (visible and
 * still counting), whether the list is being brought up to date, and whether this visit
 * should start that job (unread marks, and no live run or very recent failure).
 */
export async function getCourseMisconceptionState(userId: string, courseId: string) {
  const [all, unread, job] = await Promise.all([
    listMisconceptions(userId, courseId),
    findUnreadMarks(userId, courseId),
    getMisconceptionJob(userId, courseId),
  ]);
  const age = job ? Date.now() - job.statusUpdatedAt.getTime() : Infinity;
  const running = job?.status === "building" && age < STALE_JOB_MS;
  const failedJustNow = job?.status === "failed" && age < RETRY_AFTER_FAILURE_MS;
  const shouldStart = unread.length > 0 && !running && !failedJustNow;
  return {
    visible: all.filter((m) => !m.hidden && m.timesSeen >= 1),
    updating: running || shouldStart,
    shouldStart,
  };
}
