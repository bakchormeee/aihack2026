// The course skill map data (contract C5). Mastery is never stored: it is
// replayed from the user's marked attempts every time it is read.

import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  revisionSessions,
  sheets,
  spotAnswers,
  spotItems,
  topicPrereqs,
  topics,
} from "@/db/schema";
import type { HintLevel } from "@/lib/domain";
import { attemptHintLevel, currentMark } from "@/lib/marking/rules";
import { replayMastery, type MarkedAttempt } from "@/lib/mastery/mastery";
import { gradeOf, replaySchedule, type Schedule } from "@/lib/spaced/review";

export type TopicMastery = {
  id: string;
  name: string;
  parentId: string | null;
  mastery: number | null;
  confidence: number;
  priority: number;
  attempts: number;
  series: { at: Date; mastery: number }[];
  /** The topic's spaced-review schedule, replayed from the same marks; null when untried. */
  review: Schedule | null;
};

export type CourseMastery = {
  topics: TopicMastery[];
  prereqs: { topicId: string; prereqId: string }[];
};

/** Hint levels revealed during each attempt, keyed by attempt id. */
async function revealedLevels(attemptIds: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (attemptIds.length === 0) return result;
  const rows = await db
    .select({ attemptId: hintReveals.attemptId, level: hints.level })
    .from(hintReveals)
    .innerJoin(hints, eq(hintReveals.hintId, hints.id))
    .where(inArray(hintReveals.attemptId, attemptIds));
  for (const row of rows)
    result.set(row.attemptId, [...(result.get(row.attemptId) ?? []), row.level]);
  return result;
}

export async function getCourseMastery(userId: string, courseId: string): Promise<CourseMastery> {
  const topicRows = await db
    .select({ topic: topics })
    .from(topics)
    .innerJoin(courses, eq(topics.courseId, courses.id))
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)));
  if (topicRows.length === 0) return { topics: [], prereqs: [] };
  const topicIds = topicRows.map((r) => r.topic.id);

  const prereqs = await db
    .select({ topicId: topicPrereqs.topicId, prereqId: topicPrereqs.prereqId })
    .from(topicPrereqs)
    .where(inArray(topicPrereqs.topicId, topicIds));

  // One row per (attempt, topic) for this user's attempts on this course's questions.
  const rows = await db
    .select({
      attemptId: attempts.id,
      topicId: questionTopics.topicId,
      startedAt: attempts.startedAt,
      secondsSpent: attempts.secondsSpent,
      inherited: attempts.inheritedHintLevel,
      expectedMinutes: questions.expectedMinutes,
    })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(questionTopics, eq(questionTopics.questionId, questions.id))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(questions.courseId, courseId),
        inArray(questionTopics.topicId, topicIds),
      ),
    );

  const attemptIds = [...new Set(rows.map((r) => r.attemptId))];
  const markRows = attemptIds.length
    ? await db.select().from(marks).where(inArray(marks.attemptId, attemptIds))
    : [];
  const marksByAttempt = new Map<string, (typeof markRows)[number][]>();
  for (const m of markRows)
    marksByAttempt.set(m.attemptId, [...(marksByAttempt.get(m.attemptId) ?? []), m]);
  const revealed = await revealedLevels(attemptIds);

  const byTopic = new Map<string, MarkedAttempt[]>();
  for (const r of rows) {
    const mark = currentMark(marksByAttempt.get(r.attemptId) ?? []);
    if (!mark) continue;
    const attempt: MarkedAttempt = {
      at: r.startedAt,
      outcome: mark.outcome,
      score: mark.score,
      basis: mark.basis,
      hintLevel: attemptHintLevel(r.inherited as HintLevel, revealed.get(r.attemptId) ?? []),
      secondsSpent: r.secondsSpent,
      expectedMinutes: r.expectedMinutes,
    };
    byTopic.set(r.topicId, [...(byTopic.get(r.topicId) ?? []), attempt]);
  }

  // Answers to spot-the-error questions count too, at a lower weight (see replayMastery).
  const spotRows = await db
    .select({
      topicIds: spotItems.topicIds,
      answeredAt: spotAnswers.answeredAt,
      outcome: spotAnswers.outcome,
      expectedMinutes: spotItems.expectedMinutes,
    })
    .from(spotAnswers)
    .innerJoin(spotItems, eq(spotAnswers.itemId, spotItems.id))
    .innerJoin(revisionSessions, eq(spotItems.sessionId, revisionSessions.id))
    .where(
      and(
        eq(revisionSessions.userId, userId),
        eq(revisionSessions.courseId, courseId),
        isNotNull(spotAnswers.answeredAt),
        isNotNull(spotAnswers.outcome),
      ),
    );
  const ownTopics = new Set(topicIds);
  for (const row of spotRows) {
    const answer: MarkedAttempt = {
      at: row.answeredAt!,
      outcome: row.outcome!,
      score: 0,
      basis: "ai",
      hintLevel: 0,
      secondsSpent: null,
      expectedMinutes: row.expectedMinutes,
      kind: "spot",
    };
    for (const topicId of row.topicIds)
      if (ownTopics.has(topicId)) byTopic.set(topicId, [...(byTopic.get(topicId) ?? []), answer]);
  }

  const now = new Date();
  return {
    topics: topicRows.map(({ topic }) => {
      const list = byTopic.get(topic.id) ?? [];
      const replay = replayMastery(list, now);
      return {
        id: topic.id,
        name: topic.name,
        parentId: topic.parentId,
        mastery: list.length === 0 ? null : replay.mastery,
        confidence: replay.confidence,
        priority: replay.priority,
        attempts: list.length,
        series: replay.series,
        review: replaySchedule(
          list.map((a) => ({ at: a.at, grade: gradeOf(a) })),
          now,
        ),
      };
    }),
    prereqs,
  };
}

/** Sheet uploads and finished revision sessions of the course, oldest first, for the progress chart. */
export async function getCourseEvents(
  userId: string,
  courseId: string,
): Promise<{ at: Date; kind: "sheet" | "revision"; label: string }[]> {
  const sheetRows = await db
    .select({ at: sheets.uploadedAt, title: sheets.title })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheets.courseId, courseId), eq(courses.userId, userId)));
  const sessionRows = await db
    .select({
      at: revisionSessions.createdAt,
      mode: revisionSessions.mode,
      minutes: revisionSessions.targetMinutes,
      questions: revisionSessions.questionCount,
    })
    .from(revisionSessions)
    .where(
      and(
        eq(revisionSessions.courseId, courseId),
        eq(revisionSessions.userId, userId),
        eq(revisionSessions.status, "ready"),
      ),
    );
  return [
    ...sheetRows.map((r) => ({ at: r.at, kind: "sheet" as const, label: r.title })),
    ...sessionRows.map((r) => ({
      at: r.at,
      kind: "revision" as const,
      label:
        r.mode === "spot_error"
          ? `Spot the error, ${r.questions} questions`
          : `Revision, ${r.minutes} min`,
    })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());
}
