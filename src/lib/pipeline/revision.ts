// Background job: build a revision session (task V2). Picks the questions to
// retry, writes a fresh variant for the rest of the time, and saves the items.
// Safe to run twice: only the run that flips `building` to `ready` saves anything.

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  hints,
  marks,
  attempts,
  questions,
  questionTopics,
  revisionItems,
  revisionSessions,
  solutions,
} from "@/db/schema";
import { getCourseMastery } from "@/db/queries/mastery";
import { listRetryCandidates } from "@/db/queries/revision";
import { withAiUser } from "@/lib/ai/budget";
import { generateVariant } from "@/lib/ai/generate-variant";
import { mapLimit } from "@/lib/concurrency";
import { buildQueue } from "@/lib/mastery/queue";

export type RevisionIo = { generateVariant: typeof generateVariant };

const defaultIo: RevisionIo = { generateVariant };

/** How many variants are written at once. */
export const VARIANT_CONCURRENCY = 5;

async function errorSummaryFor(questionId: string): Promise<string | null> {
  const [row] = await db
    .select({ step: marks.firstWrongStep, type: marks.errorType, feedback: marks.feedback })
    .from(marks)
    .innerJoin(attempts, eq(marks.attemptId, attempts.id))
    .where(eq(attempts.questionId, questionId))
    .orderBy(desc(marks.createdAt))
    .limit(1);
  if (!row) return null;
  const parts = [
    row.type ? `Error type: ${row.type}.` : null,
    row.step ? `First wrong step: ${row.step}` : null,
  ];
  const text = parts.filter(Boolean).join(" ");
  return text || null;
}

async function failSession(sessionId: string, error: unknown) {
  console.error(`revision session ${sessionId} failed`, error);
  await db
    .update(revisionSessions)
    .set({ status: "failed", statusUpdatedAt: new Date() })
    .where(and(eq(revisionSessions.id, sessionId), eq(revisionSessions.status, "building")));
}

export async function buildRevisionSession(
  sessionId: string,
  io: RevisionIo = defaultIo,
  now: Date = new Date(),
): Promise<void> {
  const [session] = await db
    .select()
    .from(revisionSessions)
    .where(eq(revisionSessions.id, sessionId));
  if (!session || session.status !== "building") return;
  // Spot-the-error sessions are sized in questions and built by their own job.
  if (session.mode !== "long_form" || session.targetMinutes === null) return;
  const targetMinutes = session.targetMinutes;

  await withAiUser(session.userId, async () => {
    try {
      const candidates = await listRetryCandidates(
        session.userId,
        session.courseId,
        session.topicIds,
      );
      if (candidates.length === 0) throw new Error("no questions to revise");

      const mastery = await getCourseMastery(session.userId, session.courseId);
      const priorityByTopic = Object.fromEntries(mastery.topics.map((t) => [t.id, t.priority]));
      const dueTopics = mastery.topics.flatMap((t) =>
        t.review ? [{ id: t.id, name: t.name, daysUntilDue: t.review.daysUntilDue }] : [],
      );
      const { items } = buildQueue({
        candidates,
        priorityByTopic,
        dueTopics,
        targetMinutes,
        now,
      });

      const parentIds = [
        ...new Set(items.filter((i) => i.source === "variant").map((i) => i.questionId)),
      ];
      const parents = parentIds.length
        ? await db.select().from(questions).where(inArray(questions.id, parentIds))
        : [];
      const parentSolutions = parentIds.length
        ? await db.select().from(solutions).where(inArray(solutions.questionId, parentIds))
        : [];
      const parentTopics = parentIds.length
        ? await db
            .select()
            .from(questionTopics)
            .where(inArray(questionTopics.questionId, parentIds))
        : [];

      // The slow part. Nothing is saved yet, so a losing parallel run wastes only AI calls.
      const generated = await mapLimit(
        items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.source === "variant"),
        VARIANT_CONCURRENCY,
        async ({ item, index }) => {
          const parent = parents.find((p) => p.id === item.questionId)!;
          const official = parentSolutions.find(
            (s) => s.questionId === parent.id && s.basis === "official",
          );
          const ai = parentSolutions.find((s) => s.questionId === parent.id && s.basis === "ai");
          const variant = await io.generateVariant({
            parentBody: parent.body,
            parentSolution: (official ?? ai)?.body ?? "",
            errorSummary: await errorSummaryFor(parent.id),
          });
          return { index, parent, variant };
        },
      );

      await db.transaction(async (tx) => {
        // Claim the result: whichever run gets here first saves, the others stop.
        const claimed = await tx
          .update(revisionSessions)
          .set({ status: "ready", statusUpdatedAt: new Date() })
          .where(and(eq(revisionSessions.id, sessionId), eq(revisionSessions.status, "building")))
          .returning({ id: revisionSessions.id });
        if (claimed.length === 0) return;

        const questionIdAt = new Map<number, string>();
        for (const { index, parent, variant } of generated) {
          const [row] = await tx
            .insert(questions)
            .values({
              courseId: parent.courseId,
              sheetId: null,
              position: parent.position,
              label: `${parent.label} (variant)`,
              body: variant.body,
              expectedMinutes: variant.expectedMinutes,
              source: "variant",
              parentQuestionId: parent.id,
              hintsStatus: "ready",
            })
            .returning({ id: questions.id });
          const topicIds = parentTopics
            .filter((t) => t.questionId === parent.id)
            .map((t) => t.topicId);
          if (topicIds.length) {
            await tx
              .insert(questionTopics)
              .values(topicIds.map((topicId) => ({ questionId: row.id, topicId })));
          }
          await tx
            .insert(hints)
            .values(variant.hints.map((body, i) => ({ questionId: row.id, level: i + 1, body })));
          await tx
            .insert(solutions)
            .values({ questionId: row.id, basis: "ai", body: variant.solution });
          questionIdAt.set(index, row.id);
        }

        await tx.insert(revisionItems).values(
          items.map((item, index) => ({
            sessionId,
            questionId: questionIdAt.get(index) ?? item.questionId,
            position: index + 1,
            source: item.source,
            reason: item.reason,
          })),
        );
      });
    } catch (error) {
      await failSession(sessionId, error);
    }
  });
}
