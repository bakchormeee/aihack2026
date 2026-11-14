// Background job: keep a course's list of common errors up to date
// (SPEC-spot-the-error.md). It reads the current marks of the student's attempts
// that it has not read yet, asks the AI to place their mistakes in the existing list,
// saves the placements and records the marks as read. One run per course at a time;
// safe to run twice.

import { and, eq, lt, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  misconceptionJobs,
  misconceptionMarks,
  misconceptionSources,
  misconceptions,
} from "@/db/schema";
import {
  groupMisconceptions,
  type ExistingMisconception,
  type NumberedMistake,
} from "@/lib/ai/group-misconceptions";
import { findUnreadMarks, type UnreadMark } from "@/db/queries/misconceptions";
import { STALE_JOB_MS, type ErrorType } from "@/lib/domain";

export type MisconceptionIo = { group: typeof groupMisconceptions };

const defaultIo: MisconceptionIo = { group: groupMisconceptions };

/** The most mistakes sent to the AI at once. A mark's mistakes always go together. */
export const MAX_MISTAKES_PER_CALL = 40;
const MAX_ROUNDS = 10;

type Found = { index: number; type: ErrorType; quote: string };

/** The mistakes of a mark. A mark from before Marking v2 has only its first wrong step. */
function mistakesOf(mark: UnreadMark["mark"]): Found[] {
  if (mark.mistakes) return mark.mistakes.map((m, index) => ({ index, ...pick(m) }));
  if (mark.firstWrongStep)
    return [{ index: 0, type: mark.errorType ?? "method", quote: mark.firstWrongStep }];
  return [];
}
const pick = (m: { type: ErrorType; quote: string }) => ({ type: m.type, quote: m.quote });

/** Takes the course's job, unless a run that is not stale already holds it. */
async function claim(userId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .insert(misconceptionJobs)
    .values({ userId, courseId })
    .onConflictDoUpdate({
      target: [misconceptionJobs.userId, misconceptionJobs.courseId],
      set: { status: "building", statusUpdatedAt: new Date() },
      setWhere: or(
        ne(misconceptionJobs.status, "building"),
        lt(misconceptionJobs.statusUpdatedAt, new Date(Date.now() - STALE_JOB_MS)),
      ),
    })
    .returning({ userId: misconceptionJobs.userId });
  return rows.length > 0;
}

const finish = (userId: string, courseId: string, status: "ready" | "failed") =>
  db
    .update(misconceptionJobs)
    .set({ status, statusUpdatedAt: new Date() })
    .where(and(eq(misconceptionJobs.userId, userId), eq(misconceptionJobs.courseId, courseId)));

export async function refreshMisconceptions(
  userId: string,
  courseId: string,
  io: MisconceptionIo = defaultIo,
): Promise<void> {
  if (!(await claim(userId, courseId))) return;

  try {
    // A mark that arrives while this runs is picked up by the next round.
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const unread = await findUnreadMarks(userId, courseId);
      if (unread.length === 0) break;

      const batch: { item: UnreadMark; found: Found[] }[] = [];
      let count = 0;
      for (const item of unread) {
        const found = mistakesOf(item.mark);
        if (batch.length > 0 && count + found.length > MAX_MISTAKES_PER_CALL) break;
        batch.push({ item, found });
        count += found.length;
      }

      const existing = await db
        .select()
        .from(misconceptions)
        .where(and(eq(misconceptions.userId, userId), eq(misconceptions.courseId, courseId)));
      const shortId = new Map(existing.map((m, i) => [`m${i + 1}`, m]));

      const numbered: (NumberedMistake & { item: UnreadMark; found: Found })[] = [];
      for (const { item, found } of batch)
        for (const f of found)
          numbered.push({
            n: numbered.length + 1,
            type: f.type,
            quote: f.quote,
            topics: item.topics.map((t) => t.name),
            item,
            found: f,
          });

      const placements = numbered.length
        ? await io.group({
            existing: [...shortId].map(([id, m]): ExistingMisconception => ({
              id,
              description: m.description,
              hidden: m.hiddenAt !== null,
            })),
            mistakes: numbered.map(({ n, type, quote, topics }) => ({ n, type, quote, topics })),
          })
        : [];

      await db.transaction(async (tx) => {
        const created = new Map<string, string>(); // description -> new misconception id
        for (const placement of placements) {
          const mistake = numbered.find((m) => m.n === placement.mistake)!;
          let misconceptionId: string;
          if ("existing" in placement) {
            misconceptionId = shortId.get(placement.existing)!.id;
          } else if (created.has(placement.description)) {
            misconceptionId = created.get(placement.description)!;
          } else {
            const [row] = await tx
              .insert(misconceptions)
              .values({
                userId,
                courseId,
                description: placement.description,
                errorType: mistake.type,
              })
              .returning({ id: misconceptions.id });
            created.set(placement.description, row.id);
            misconceptionId = row.id;
          }
          await tx
            .insert(misconceptionSources)
            .values({
              misconceptionId,
              markId: mistake.item.mark.id,
              mistakeIndex: mistake.found.index,
              attemptId: mistake.item.attemptId,
              topicIds: mistake.item.topics.map((t) => t.id),
              quote: mistake.found.quote,
            })
            .onConflictDoNothing();
        }
        await tx
          .insert(misconceptionMarks)
          .values(batch.map(({ item }) => ({ markId: item.mark.id, userId, courseId })))
          .onConflictDoNothing();
      });
    }
    await finish(userId, courseId, "ready");
  } catch (error) {
    console.error(`grouping misconceptions for course ${courseId} failed`, error);
    await finish(userId, courseId, "failed");
  }
}
