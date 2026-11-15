// Demo copies (SPEC-demo.md, section 2). A judge who opens /demo gets a private copy of
// the template student: every row is copied with a new id and every time is shifted so
// the template's newest activity happens now. Files are not copied: a copy reads the
// template's files, and erasing a copy deletes only files under the copy's own folder.

import { and, eq, gt, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "@/db";
import * as s from "@/db/schema";
import {
  copiesToErase,
  DEMO_COPY_HOURS,
  DEMO_MAX_COPIES,
  expiryOf,
  timeShift,
} from "@/lib/demo/rules";
import { deleteObject } from "@/lib/storage/s3";

export const DEMO_TEMPLATE_EMAIL = "demo-template@demo.invalid";

/** There is no template to copy (the template script has not been run). */
export class DemoUnavailableError extends Error {
  constructor() {
    super("The demo is not available yet.");
    this.name = "DemoUnavailableError";
  }
}

export type DemoFileIo = { deleteObject(key: string): Promise<void> };
const defaultIo: DemoFileIo = { deleteObject };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = typeof db | Tx;

/** `column in ids`, false for no ids. */
function within(column: PgColumn, ids: string[]): SQL {
  return ids.length ? inArray(column, ids) : sql`false`;
}

/** Every row one user owns, table by table. */
async function readUserRows(r: Reader, userId: string) {
  const courses = await r.select().from(s.courses).where(eq(s.courses.userId, userId));
  const courseIds = courses.map((c) => c.id);
  const [topics, sheets, questions, revisionSessions, attempts, misconceptions] = await Promise.all(
    [
      r.select().from(s.topics).where(within(s.topics.courseId, courseIds)),
      r.select().from(s.sheets).where(within(s.sheets.courseId, courseIds)),
      r.select().from(s.questions).where(within(s.questions.courseId, courseIds)),
      r.select().from(s.revisionSessions).where(eq(s.revisionSessions.userId, userId)),
      r.select().from(s.attempts).where(eq(s.attempts.userId, userId)),
      r.select().from(s.misconceptions).where(eq(s.misconceptions.userId, userId)),
    ],
  );
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((x) => x.id);
  const [topicIds, sheetIds, questionIds, sessionIds, attemptIds] = [
    ids(topics),
    ids(sheets),
    ids(questions),
    ids(revisionSessions),
    ids(attempts),
  ];
  const [
    topicPrereqs,
    sheetFiles,
    sheetSummaries,
    questionTopics,
    hints,
    solutions,
    revisionItems,
    spotItems,
    hintReveals,
    submissions,
    marks,
    misconceptionSources,
    misconceptionMarks,
    misconceptionJobs,
    spotAnswers,
  ] = await Promise.all([
    r.select().from(s.topicPrereqs).where(within(s.topicPrereqs.topicId, topicIds)),
    r.select().from(s.sheetFiles).where(within(s.sheetFiles.sheetId, sheetIds)),
    r.select().from(s.sheetSummaries).where(within(s.sheetSummaries.sheetId, sheetIds)),
    r.select().from(s.questionTopics).where(within(s.questionTopics.questionId, questionIds)),
    r.select().from(s.hints).where(within(s.hints.questionId, questionIds)),
    r.select().from(s.solutions).where(within(s.solutions.questionId, questionIds)),
    r.select().from(s.revisionItems).where(within(s.revisionItems.sessionId, sessionIds)),
    r.select().from(s.spotItems).where(within(s.spotItems.sessionId, sessionIds)),
    r.select().from(s.hintReveals).where(within(s.hintReveals.attemptId, attemptIds)),
    r.select().from(s.submissions).where(within(s.submissions.attemptId, attemptIds)),
    r.select().from(s.marks).where(within(s.marks.attemptId, attemptIds)),
    r
      .select()
      .from(s.misconceptionSources)
      .where(within(s.misconceptionSources.misconceptionId, ids(misconceptions))),
    r.select().from(s.misconceptionMarks).where(eq(s.misconceptionMarks.userId, userId)),
    r.select().from(s.misconceptionJobs).where(eq(s.misconceptionJobs.userId, userId)),
    r.select().from(s.spotAnswers).where(eq(s.spotAnswers.userId, userId)),
  ]);
  const submissionFiles = await r
    .select()
    .from(s.submissionFiles)
    .where(within(s.submissionFiles.submissionId, ids(submissions)));
  return {
    courses,
    topics,
    topicPrereqs,
    sheets,
    sheetFiles,
    sheetSummaries,
    questions,
    questionTopics,
    hints,
    solutions,
    revisionSessions,
    revisionItems,
    spotItems,
    attempts,
    hintReveals,
    submissions,
    submissionFiles,
    marks,
    misconceptions,
    misconceptionSources,
    misconceptionMarks,
    misconceptionJobs,
    spotAnswers,
  };
}

type UserRows = Awaited<ReturnType<typeof readUserRows>>;

/** The time of the newest thing the student did. */
function newestActivity(rows: UserRows): Date | null {
  const times = [
    ...rows.attempts.map((a) => a.startedAt),
    ...rows.marks.map((m) => m.createdAt),
    ...rows.submissions.map((x) => x.submittedAt),
    ...rows.hintReveals.map((h) => h.revealedAt),
    ...rows.revisionSessions.map((x) => x.createdAt),
    ...rows.spotAnswers.map((a) => a.answeredAt),
  ].filter((t): t is Date => t instanceof Date);
  return times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
}

const CHUNK = 500;

async function insertAll<T extends PgTable>(tx: Tx, table: T, rows: T["$inferInsert"][]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await tx.insert(table).values(rows.slice(i, i + CHUNK));
  }
}

/** Copies the template's rows to a new copy user, in one transaction. */
async function copyRows(tx: Tx, rows: UserRows, copyId: string, shiftMs: number) {
  // Every primary id gets a new id first; a reference to anything outside the
  // template's own rows throws, so a copy can never point at another user's data.
  const newIds = new Map<string, string>();
  for (const table of [
    rows.courses,
    rows.topics,
    rows.sheets,
    rows.sheetFiles,
    rows.questions,
    rows.hints,
    rows.solutions,
    rows.revisionSessions,
    rows.spotItems,
    rows.attempts,
    rows.submissions,
    rows.submissionFiles,
    rows.marks,
    rows.misconceptions,
  ]) {
    for (const row of table) newIds.set(row.id, crypto.randomUUID());
  }
  const ref = (old: string): string => {
    const id = newIds.get(old);
    if (!id) throw new Error(`Demo copy: ${old} is not a template row`);
    return id;
  };
  const refOrNull = (old: string | null) => (old === null ? null : ref(old));
  // Shift every time in a row by the same amount.
  const shift = <T extends object>(row: T): T =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        v instanceof Date ? new Date(v.getTime() + shiftMs) : v,
      ]),
    ) as T;

  await insertAll(
    tx,
    s.courses,
    rows.courses.map((c) => shift({ ...c, id: ref(c.id), userId: copyId })),
  );
  await insertAll(
    tx,
    s.topics,
    rows.topics.map((t) => ({
      ...t,
      id: ref(t.id),
      courseId: ref(t.courseId),
      parentId: refOrNull(t.parentId),
    })),
  );
  await insertAll(
    tx,
    s.topicPrereqs,
    rows.topicPrereqs.map((p) => ({ topicId: ref(p.topicId), prereqId: ref(p.prereqId) })),
  );
  await insertAll(
    tx,
    s.sheets,
    rows.sheets.map((x) => shift({ ...x, id: ref(x.id), courseId: ref(x.courseId) })),
  );
  // File paths stay the template's: the copy reads the template's files.
  await insertAll(
    tx,
    s.sheetFiles,
    rows.sheetFiles.map((f) => ({ ...f, id: ref(f.id), sheetId: ref(f.sheetId) })),
  );
  await insertAll(
    tx,
    s.sheetSummaries,
    rows.sheetSummaries.map((x) => shift({ ...x, sheetId: ref(x.sheetId) })),
  );
  await insertAll(
    tx,
    s.questions,
    rows.questions.map((q) =>
      shift({
        ...q,
        id: ref(q.id),
        courseId: ref(q.courseId),
        sheetId: refOrNull(q.sheetId),
        parentQuestionId: refOrNull(q.parentQuestionId),
      }),
    ),
  );
  await insertAll(
    tx,
    s.questionTopics,
    rows.questionTopics.map((x) => ({ questionId: ref(x.questionId), topicId: ref(x.topicId) })),
  );
  await insertAll(
    tx,
    s.hints,
    rows.hints.map((h) => ({ ...h, id: ref(h.id), questionId: ref(h.questionId) })),
  );
  await insertAll(
    tx,
    s.solutions,
    rows.solutions.map((x) => ({ ...x, id: ref(x.id), questionId: ref(x.questionId) })),
  );
  await insertAll(
    tx,
    s.revisionSessions,
    rows.revisionSessions.map((x) =>
      shift({
        ...x,
        id: ref(x.id),
        userId: copyId,
        courseId: ref(x.courseId),
        topicIds: x.topicIds === null ? null : x.topicIds.map(ref),
      }),
    ),
  );
  await insertAll(
    tx,
    s.revisionItems,
    rows.revisionItems.map((x) => ({
      ...x,
      sessionId: ref(x.sessionId),
      questionId: ref(x.questionId),
    })),
  );
  await insertAll(
    tx,
    s.attempts,
    rows.attempts.map((a) =>
      shift({
        ...a,
        id: ref(a.id),
        userId: copyId,
        questionId: ref(a.questionId),
        revisionSessionId: refOrNull(a.revisionSessionId),
      }),
    ),
  );
  await insertAll(
    tx,
    s.hintReveals,
    rows.hintReveals.map((h) =>
      shift({ ...h, attemptId: ref(h.attemptId), hintId: ref(h.hintId) }),
    ),
  );
  await insertAll(
    tx,
    s.submissions,
    rows.submissions.map((x) => shift({ ...x, id: ref(x.id), attemptId: ref(x.attemptId) })),
  );
  await insertAll(
    tx,
    s.submissionFiles,
    rows.submissionFiles.map((f) => ({ ...f, id: ref(f.id), submissionId: ref(f.submissionId) })),
  );
  await insertAll(
    tx,
    s.marks,
    rows.marks.map((m) => shift({ ...m, id: ref(m.id), attemptId: ref(m.attemptId) })),
  );
  await insertAll(
    tx,
    s.misconceptions,
    rows.misconceptions.map((m) =>
      shift({ ...m, id: ref(m.id), userId: copyId, courseId: ref(m.courseId) }),
    ),
  );
  await insertAll(
    tx,
    s.misconceptionSources,
    rows.misconceptionSources.map((x) => ({
      ...x,
      misconceptionId: ref(x.misconceptionId),
      markId: ref(x.markId),
      attemptId: ref(x.attemptId),
      topicIds: x.topicIds.map(ref),
    })),
  );
  await insertAll(
    tx,
    s.misconceptionMarks,
    rows.misconceptionMarks.map((x) =>
      shift({ ...x, markId: ref(x.markId), userId: copyId, courseId: ref(x.courseId) }),
    ),
  );
  await insertAll(
    tx,
    s.misconceptionJobs,
    rows.misconceptionJobs.map((x) => shift({ ...x, userId: copyId, courseId: ref(x.courseId) })),
  );
  await insertAll(
    tx,
    s.spotItems,
    rows.spotItems.map((x) => ({
      ...x,
      id: ref(x.id),
      sessionId: ref(x.sessionId),
      topicIds: x.topicIds.map(ref),
      planted: x.planted.map((p) => ({ ...p, misconceptionId: ref(p.misconceptionId) })),
    })),
  );
  await insertAll(
    tx,
    s.spotAnswers,
    rows.spotAnswers.map((x) => shift({ ...x, itemId: ref(x.itemId), userId: copyId })),
  );
}

/**
 * Makes a private copy of the template student at `now`, after erasing expired copies
 * and the oldest copies over the cap. Returns the new copy user.
 */
export async function createDemoCopy(now: Date = new Date(), io: DemoFileIo = defaultIo) {
  await eraseExpiredDemoCopies(now, io);
  const [template] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.demoRole, "template"))
    .limit(1);
  if (!template) throw new DemoUnavailableError();

  const rows = await readUserRows(db, template.id);
  const shiftMs = timeShift(newestActivity(rows), now);
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(s.users)
      .values({
        name: template.name,
        demoRole: "copy",
        demoExpiresAt: expiryOf(now),
        demoAiCalls: 0,
      })
      .returning();
    await copyRows(tx, rows, copy.id, shiftMs);
    return copy;
  });
}

/** The user, when it is a demo copy that has not expired; otherwise null. */
export async function findLiveDemoCopy(userId: string, now: Date = new Date()) {
  const [copy] = await db
    .select()
    .from(s.users)
    .where(
      and(eq(s.users.id, userId), eq(s.users.demoRole, "copy"), gt(s.users.demoExpiresAt, now)),
    );
  return copy ?? null;
}

/**
 * Erases a demo user (a copy, or the template when it is rebuilt) with every row it
 * owns, then the files under its own folder `u/<userId>/`. Never a real user.
 */
export async function eraseDemoUser(userId: string, io: DemoFileIo = defaultIo): Promise<void> {
  const [user] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, userId), isNotNull(s.users.demoRole)));
  if (!user) throw new Error("Only a demo user can be erased");

  const rows = await readUserRows(db, userId);
  const own = `u/${userId}/`;
  const files = [...rows.sheetFiles, ...rows.submissionFiles]
    .map((f) => f.path)
    .filter((path) => path.startsWith(own));
  const ids = <T extends { id: string }>(list: T[]) => list.map((x) => x.id);
  const attemptIds = ids(rows.attempts);

  await db.transaction(async (tx) => {
    // History rows have no cascade, so they go first, in foreign-key order.
    await tx.delete(s.hintReveals).where(within(s.hintReveals.attemptId, attemptIds));
    await tx
      .delete(s.submissionFiles)
      .where(within(s.submissionFiles.submissionId, ids(rows.submissions)));
    await tx.delete(s.submissions).where(within(s.submissions.attemptId, attemptIds));
    await tx.delete(s.marks).where(within(s.marks.attemptId, attemptIds));
    await tx
      .delete(s.revisionItems)
      .where(within(s.revisionItems.sessionId, ids(rows.revisionSessions)));
    await tx.delete(s.attempts).where(eq(s.attempts.userId, userId));
    // Everything else cascades from the user.
    await tx.delete(s.users).where(eq(s.users.id, userId));
  });

  for (const key of files) {
    try {
      await io.deleteObject(key);
    } catch (error) {
      console.error(`Demo erase: could not delete ${key}`, error);
    }
  }
}

/** Erases a demo copy. Refuses the template and real users. */
export async function eraseDemoCopy(userId: string, io: DemoFileIo = defaultIo): Promise<void> {
  const [copy] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.id, userId), eq(s.users.demoRole, "copy")));
  if (!copy) throw new Error("Only a demo copy can be erased");
  await eraseDemoUser(userId, io);
}

/** Erases expired copies, then the oldest live ones over `max`. Returns the erased ids. */
export async function eraseExpiredDemoCopies(
  now: Date = new Date(),
  io: DemoFileIo = defaultIo,
  max: number = DEMO_MAX_COPIES,
): Promise<string[]> {
  const copies = await db
    .select({ id: s.users.id, expiresAt: s.users.demoExpiresAt })
    .from(s.users)
    .where(eq(s.users.demoRole, "copy"));
  const hours = DEMO_COPY_HOURS * 60 * 60 * 1000;
  const erase = copiesToErase(
    copies.map((c) => ({
      id: c.id,
      expiresAt: c.expiresAt,
      createdAt: new Date(c.expiresAt ? c.expiresAt.getTime() - hours : 0),
    })),
    now,
    max,
  );
  for (const id of erase) await eraseDemoCopy(id, io);
  return erase;
}
