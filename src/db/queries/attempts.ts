// Attempts and hint reveals (tasks M6–M8 share this file; each adds its own functions).

import { and, asc, desc, eq, isNull, lte, notExists, sql } from "drizzle-orm";

import { db } from "@/db";
import { attempts, hintReveals, hints, questions, submissions } from "@/db/schema";
import { requireAttempt, requireQuestion } from "@/lib/auth/ownership";
import type { HintLevel } from "@/lib/domain";
import { attemptHintLevel } from "@/lib/marking/rules";

export class HintsNotReadyError extends Error {
  constructor() {
    super("The hints for this question are still being prepared.");
    this.name = "HintsNotReadyError";
  }
}

export class NoMoreHintsError extends Error {
  constructor() {
    super("All three hints have been shown.");
    this.name = "NoMoreHintsError";
  }
}

type Attempt = typeof attempts.$inferSelect;

/** Highest hint level visible during the attempt: inherited or revealed. */
async function currentHintLevel(attempt: Attempt): Promise<HintLevel> {
  const rows = await db
    .select({ level: hints.level })
    .from(hintReveals)
    .innerJoin(hints, eq(hintReveals.hintId, hints.id))
    .where(eq(hintReveals.attemptId, attempt.id));
  return attemptHintLevel(
    attempt.inheritedHintLevel as HintLevel,
    rows.map((row) => row.level),
  );
}

function sessionFilter(sessionId: string | undefined) {
  return sessionId ? eq(attempts.revisionSessionId, sessionId) : isNull(attempts.revisionSessionId);
}

/** The attempt the student is working on, if there is one. Never creates anything. */
export async function findOpenAttemptFor(
  userId: string,
  questionId: string,
  sessionId?: string,
): Promise<Attempt | null> {
  await requireQuestion(userId, questionId);
  const [open] = await db
    .select()
    .from(attempts)
    .where(
      and(
        eq(attempts.userId, userId),
        eq(attempts.questionId, questionId),
        sessionFilter(sessionId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(submissions)
            .where(
              and(
                eq(submissions.attemptId, attempts.id),
                sql`${submissions.submittedAt} is not null`,
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(attempts.startedAt))
    .limit(1);
  return open ?? null;
}

/**
 * The attempt the student is working on: the latest one with no submitted
 * working, or a new one. Calling it again returns the same attempt, so it is
 * safe to call whenever a question screen opens.
 */
export async function openAttemptFor(
  userId: string,
  questionId: string,
  sessionId?: string,
): Promise<Attempt> {
  await requireQuestion(userId, questionId);

  return db.transaction(async (tx) => {
    // Two overlapping calls for the same question must not both create an attempt.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${questionId}`}))`);

    const [open] = await tx
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.questionId, questionId),
          sessionFilter(sessionId),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(submissions)
              .where(
                and(
                  eq(submissions.attemptId, attempts.id),
                  sql`${submissions.submittedAt} is not null`,
                ),
              ),
          ),
        ),
      )
      .orderBy(desc(attempts.startedAt))
      .limit(1);
    if (open) return open;

    const [created] = await tx
      .insert(attempts)
      .values({
        userId,
        questionId,
        context: sessionId ? "revision" : "sheet",
        revisionSessionId: sessionId ?? null,
      })
      .returning();
    return created;
  });
}

/**
 * Always starts a new attempt. "retry-now" keeps the hints the student had
 * already seen on their latest attempt; "fresh" hides them all.
 */
export async function startAttemptFor(
  userId: string,
  questionId: string,
  mode: "retry-now" | "fresh",
  sessionId?: string,
): Promise<Attempt> {
  await requireQuestion(userId, questionId);

  let inherited: HintLevel = 0;
  if (mode === "retry-now") {
    const [previous] = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionId, questionId)))
      .orderBy(desc(attempts.startedAt))
      .limit(1);
    if (previous) inherited = await currentHintLevel(previous);
  }

  const [created] = await db
    .insert(attempts)
    .values({
      userId,
      questionId,
      context: sessionId ? "revision" : "sheet",
      revisionSessionId: sessionId ?? null,
      inheritedHintLevel: inherited,
    })
    .returning();
  return created;
}

/** Reveals the next hint (strictly in order) and records it. Returns the hint text. */
export async function revealNextHintFor(
  userId: string,
  attemptId: string,
): Promise<{ level: 1 | 2 | 3; body: string }> {
  const attempt = await requireAttempt(userId, attemptId);
  const next = (await currentHintLevel(attempt)) + 1;
  if (next > 3) throw new NoMoreHintsError();

  const [question] = await db.select().from(questions).where(eq(questions.id, attempt.questionId));
  if (question.hintsStatus !== "ready") throw new HintsNotReadyError();

  const [hint] = await db
    .select()
    .from(hints)
    .where(and(eq(hints.questionId, attempt.questionId), eq(hints.level, next)));
  if (!hint) throw new HintsNotReadyError();

  await db.insert(hintReveals).values({ attemptId, hintId: hint.id }).onConflictDoNothing();
  return { level: next as 1 | 2 | 3, body: hint.body };
}

/** The hints the student may see in this attempt (revealed or inherited): never any other. */
export async function visibleHintsFor(
  userId: string,
  attemptId: string,
): Promise<{ level: HintLevel; hints: { level: number; body: string }[] }> {
  const attempt = await requireAttempt(userId, attemptId);
  const level = await currentHintLevel(attempt);
  if (level === 0) return { level, hints: [] };

  const rows = await db
    .select({ level: hints.level, body: hints.body })
    .from(hints)
    .where(and(eq(hints.questionId, attempt.questionId), lte(hints.level, level)))
    .orderBy(asc(hints.level));
  return { level, hints: rows };
}

/** Where a question sits on its sheet, and its neighbours. Throws NotFoundError unless it is the user's. */
export async function getSheetNeighbours(userId: string, questionId: string) {
  const question = await requireQuestion(userId, questionId);
  if (!question.sheetId) {
    // A revision variant has no sheet.
    return { sheetId: null, prevId: null, nextId: null, position: 1, total: 1 };
  }
  const siblings = await db
    .select({ id: questions.id, position: questions.position })
    .from(questions)
    .where(eq(questions.sheetId, question.sheetId))
    .orderBy(asc(questions.position));
  const index = siblings.findIndex((row) => row.id === questionId);
  return {
    sheetId: question.sheetId,
    prevId: siblings[index - 1]?.id ?? null,
    nextId: siblings[index + 1]?.id ?? null,
    position: index + 1,
    total: siblings.length,
  };
}
