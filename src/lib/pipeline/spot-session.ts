// Background job: build a spot-the-error session (SPEC-spot-the-error.md). Deals the
// student's common errors across the questions, has the AI write each flawed solution,
// and saves the items. Safe to run twice: only the run that flips `building` to `ready`
// saves anything.

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { rankedMisconceptionsFor } from "@/db/queries/spot";
import { courses, revisionSessions, spotItems, topics } from "@/db/schema";
import { writeFlawedSolution } from "@/lib/ai/write-flawed-solution";
import { mapLimit } from "@/lib/concurrency";
import { dealQuestions } from "@/lib/spot/rules";

export type SpotIo = { write: typeof writeFlawedSolution };

const defaultIo: SpotIo = { write: writeFlawedSolution };

/** How many exercises are written at once. */
export const SPOT_CONCURRENCY = 5;

async function failSession(sessionId: string, error: unknown) {
  console.error(`spot-the-error session ${sessionId} failed`, error);
  await db
    .update(revisionSessions)
    .set({ status: "failed", statusUpdatedAt: new Date() })
    .where(and(eq(revisionSessions.id, sessionId), eq(revisionSessions.status, "building")));
}

export async function buildSpotSession(
  sessionId: string,
  io: SpotIo = defaultIo,
  random: () => number = Math.random,
): Promise<void> {
  const [session] = await db
    .select()
    .from(revisionSessions)
    .where(eq(revisionSessions.id, sessionId));
  if (!session || session.status !== "building") return;
  if (session.mode !== "spot_error" || session.questionCount === null) return;
  const { questionCount } = session;

  try {
    const ranked = await rankedMisconceptionsFor(
      session.userId,
      session.courseId,
      session.topicIds,
    );
    if (ranked.length === 0) throw new Error("no common errors to plant");
    const byId = new Map(ranked.map((m) => [m.id, m]));
    const deal = dealQuestions(
      questionCount,
      ranked.map((m) => m.id),
      random,
    );

    const [course] = await db.select().from(courses).where(eq(courses.id, session.courseId));
    const topicRows = await db.select().from(topics).where(eq(topics.courseId, session.courseId));
    const topicName = new Map(topicRows.map((t) => [t.id, t.name]));

    // The slow part. Nothing is saved yet, so a losing parallel run wastes only AI calls.
    const written = await mapLimit(deal, SPOT_CONCURRENCY, async (question) => {
      const focus = byId.get(question.focus)!;
      const topicIds = session.topicIds?.length
        ? focus.topicIds.filter((id) => session.topicIds!.includes(id))
        : focus.topicIds;
      const plant = question.plant.map((id, i) => ({
        short: `e${i + 1}`,
        misconception: byId.get(id)!,
      }));
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const solution = await io.write({
            topics: topicIds.map((id) => topicName.get(id)!).filter(Boolean),
            courseName: course.name,
            plant: plant.map((p) => ({
              id: p.short,
              description: p.misconception.description,
              example: p.misconception.example,
            })),
          });
          return {
            topicIds,
            solution,
            planted: solution.planted.map((p) => ({
              line: p.line,
              misconceptionId: plant.find((x) => x.short === p.misconception)!.misconception.id,
              whatsWrong: p.whatsWrong,
              correctLine: p.correctLine,
            })),
          };
        } catch (error) {
          // One more try, then the question is left out of the session.
          if (attempt === 2) console.error(`spot question for session ${sessionId} dropped`, error);
        }
      }
      return null;
    });
    const items = written.filter((w) => w !== null);
    if (items.length === 0) throw new Error("no spot-the-error question could be written");

    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(revisionSessions)
        .set({ status: "ready", statusUpdatedAt: new Date() })
        .where(and(eq(revisionSessions.id, sessionId), eq(revisionSessions.status, "building")))
        .returning({ id: revisionSessions.id });
      if (claimed.length === 0) return;

      await tx.insert(spotItems).values(
        items.map((item, index) => ({
          sessionId,
          position: index + 1,
          body: item.solution.body,
          lines: item.solution.lines,
          planted: item.planted,
          topicIds: item.topicIds,
          expectedMinutes: item.solution.expectedMinutes,
        })),
      );
    });
  } catch (error) {
    await failSession(sessionId, error);
  }
}
