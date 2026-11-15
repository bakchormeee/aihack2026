// Builds the demo template student (SPEC-demo.md, "The demo content"; decision 6 and
// task E5 in tasks/plan.md). Dev-script only: run through scripts/build-demo.ts, never
// from the app. It drives the REAL pipeline functions (parse, hints, marking, official
// re-mark, common errors, revision, spot the error) and follows planDemoHistory.
// Storage, the clock and every AI call except parsing can be injected, for tests.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { startAttemptFor, revealNextHintFor } from "@/db/queries/attempts";
import { createCourse } from "@/db/queries/courses";
import { listMisconceptions } from "@/db/queries/misconceptions";
import { createRevisionSession, getRevisionSession } from "@/db/queries/revision";
import { createSheetWithFiles } from "@/db/queries/sheets";
import { createSpotSession } from "@/db/queries/spot";
import { saveDraftText, submitWorking } from "@/db/queries/working";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questionTopics,
  questions,
  revisionSessions,
  sheets,
  spotAnswers,
  spotItems,
  submissions,
  topics,
  users,
} from "@/db/schema";
import { extractSolutions } from "@/lib/ai/extract-solutions";
import { generateHints } from "@/lib/ai/generate-hints";
import { generateVariant } from "@/lib/ai/generate-variant";
import { groupMisconceptions } from "@/lib/ai/group-misconceptions";
import { judgeSpotAnswer } from "@/lib/ai/judge-spot-answer";
import { markAttempt } from "@/lib/ai/mark-attempt";
import { writeFlawedSolution } from "@/lib/ai/write-flawed-solution";
import type { MarkBasis, Outcome } from "@/lib/domain";
import { currentMark } from "@/lib/marking/rules";
import { runHintsForSheet } from "@/lib/pipeline/hints";
import { claimMark, performMark, type MarkIo } from "@/lib/pipeline/mark";
import { refreshMisconceptions } from "@/lib/pipeline/misconceptions";
import { runParse } from "@/lib/pipeline/parse";
import { performOfficialRemark, startOfficialSolutions } from "@/lib/pipeline/remark";
import { buildRevisionSession } from "@/lib/pipeline/revision";
import { answerSpotItem } from "@/lib/pipeline/spot-answer";
import { buildSpotSession } from "@/lib/pipeline/spot-session";
import { buildKey } from "@/lib/storage/keys";

import {
  DEMO_MISCONCEPTIONS,
  mulberry32,
  planDemoHistory,
  type DemoQuestion,
  type PlannedAttempt,
} from "./history";

export const DEMO_TEMPLATE_EMAIL = "demo-template@demo.invalid";
export const DEMO_COURSES = ["Numbers", "Analysis I", "Sequences and Series"];
const DAYS = 21;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type DemoStorage = {
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
  get: (key: string) => Promise<Buffer>;
};

/** Writes a student's typed answer (scripts/demo/write-demo-working.ts). */
export type WriteDemoWorking = (i: {
  questionBody: string;
  outcome: Outcome;
  misconception: string | null;
  hintsSeen: string[];
}) => Promise<string>;

/** The AI wrappers the pipelines use; parsing is not injectable (runParse calls parseSheet). */
export type DemoAiCalls = {
  generateHints: typeof generateHints;
  markAttempt: typeof markAttempt;
  extractSolutions: typeof extractSolutions;
  groupMisconceptions: typeof groupMisconceptions;
  generateVariant: typeof generateVariant;
  writeFlawedSolution: typeof writeFlawedSolution;
  judgeSpotAnswer: typeof judgeSpotAnswer;
};

export type BuildDemoOptions = {
  /** The folder with one sub-folder per course ("Sample Problem Sheets"). */
  sheetsDir: string;
  storage: DemoStorage;
  writeWorking: WriteDemoWorking;
  /** Course folder names, default all three. */
  courses?: string[];
  /** Sheets per course, default 3. Only sheets 1 and 2 are attempted. */
  sheetsPerCourse?: number;
  /** Answer only the first N questions of each attempted sheet (default: all). */
  questionsPerSheet?: number;
  seed?: number;
  /** The end of the history; read when the rows are backdated. */
  now?: () => Date;
  /** Erases an existing template user before the new one is built (E2's eraseDemoUser). */
  eraseOld?: (userId: string) => Promise<void>;
  /** Replaces AI wrappers (tests). */
  ai?: Partial<DemoAiCalls>;
  log?: (line: string) => void;
};

export type BuildDemoReport = {
  userId: string;
  courses: number;
  sheets: number;
  attempts: number;
  planned: Record<Outcome, number>;
  actual: Record<Outcome, number>;
  misconceptions: number;
  revisionSessionId: string | null;
  spotSessionId: string | null;
  aiCalls: number;
};

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mix = (outcomes: Outcome[]) => {
  const counts: Record<Outcome, number> = { full: 0, partial: 0, stuck: 0 };
  for (const o of outcomes) counts[o]++;
  return counts;
};

const percent = (counts: Record<Outcome, number>) => {
  const total = Math.max(1, counts.full + counts.partial + counts.stuck);
  const p = (n: number) => `${Math.round((100 * n) / total)}%`;
  return `${p(counts.full)} full, ${p(counts.partial)} partial, ${p(counts.stuck)} stuck`;
};

/** "Problem Sheet <n>" (with or without .pdf) and its answers or solutions file, if any. */
async function findSheetFiles(dir: string, n: number) {
  const names = await readdir(dir);
  const sheet = names.find((name) => new RegExp(`^Problem Sheet ${n}(\\.pdf)?$`, "i").test(name));
  const answers = names.find((name) =>
    new RegExp(`^Problem Sheet ${n}\\b.*(answers|solutions)`, "i").test(name),
  );
  ensure(sheet, `No "Problem Sheet ${n}" in ${dir}`);
  return { sheet: path.join(dir, sheet), answers: answers ? path.join(dir, answers) : null };
}

/** The file's bytes; the sample files are PDFs, some without the extension. */
async function readPdf(file: string): Promise<Buffer> {
  const bytes = await readFile(file);
  ensure(bytes.subarray(0, 5).toString("latin1") === "%PDF-", `${file} is not a PDF`);
  return bytes;
}

export async function buildDemoTemplate(options: BuildDemoOptions): Promise<BuildDemoReport> {
  const log = options.log ?? console.log;
  const clock = options.now ?? (() => new Date());
  const { storage, writeWorking } = options;
  const sheetCount = options.sheetsPerCourse ?? 3;
  const courseNames = options.courses ?? DEMO_COURSES;
  ensure(
    courseNames.length > 0 && Number.isInteger(sheetCount) && sheetCount >= 1 && sheetCount <= 3,
    "Choose at least one course and 1 to 3 sheets per course.",
  );

  // Every AI call is counted (parsing is counted once per sheet in parseSheet below).
  let aiCalls = 0;
  const count =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A) => {
      aiCalls++;
      return fn(...args);
    };
  const ai: DemoAiCalls = {
    generateHints,
    markAttempt,
    extractSolutions,
    groupMisconceptions,
    generateVariant,
    writeFlawedSolution,
    judgeSpotAnswer,
    ...options.ai,
  };
  // Marking does not refresh the common errors after each mark: that is done once per
  // course at the end, so the grouping sees many mistakes in one call.
  const io = {
    hints: { generate: count(ai.generateHints) },
    mark: { readFile: storage.get, mark: count(ai.markAttempt) } satisfies MarkIo,
    group: { group: count(ai.groupMisconceptions) },
    variant: { generateVariant: count(ai.generateVariant) },
    spot: { write: count(ai.writeFlawedSolution) },
    judge: { judge: count(ai.judgeSpotAnswer) },
    write: count(writeWorking),
  };

  // An old template is replaced at the end (the script passes eraseOld); without it, refuse.
  const [old] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_TEMPLATE_EMAIL));
  if (old) ensure(options.eraseOld, "A demo template already exists. Pass eraseOld to replace it.");
  // The new template is built hidden (no email, no demo role), so /demo keeps copying the
  // old, complete one until the swap at the end. It has no account row, so nobody can
  // sign in to it directly.
  const [user] = await db.insert(users).values({ name: "Demo student" }).returning();
  const userId = user.id;
  log(`New template user ${userId} (hidden until it is finished)`);

  // 1. Courses and sheets: upload, parse, hints.
  const built: { courseId: string; sheetId: string; n: number; answers: string | null }[] = [];
  const courseIds: string[] = [];
  for (const name of courseNames) {
    const course = await createCourse(userId, name);
    courseIds.push(course.id);
    for (let n = 1; n <= sheetCount; n++) {
      const files = await findSheetFiles(path.join(options.sheetsDir, name), n);
      const key = buildKey({
        userId,
        purpose: "sheet",
        parentId: course.id,
        mime: "application/pdf",
      });
      await storage.put(key, await readPdf(files.sheet), "application/pdf");
      const sheet = await createSheetWithFiles(course.id, `Problem Sheet ${n}`, [
        { path: key, mime: "application/pdf" },
      ]);
      aiCalls++; // parseSheet
      await runParse(sheet.id, { readFile: storage.get });
      const [parsed] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
      ensure(parsed.status === "ready", `${name} sheet ${n} could not be parsed`);
      await runHintsForSheet(sheet.id, io.hints);
      built.push({ courseId: course.id, sheetId: sheet.id, n, answers: files.answers });
      log(`${name}: sheet ${n} parsed`);
    }
  }

  // 2. The planned history on sheets 1 and 2 (questions whose hints are ready).
  const early = built.filter((s) => s.n <= 2);
  const rows = await db
    .select({ question: questions, topic: topics.name })
    .from(questions)
    .leftJoin(questionTopics, eq(questionTopics.questionId, questions.id))
    .leftJoin(topics, eq(topics.id, questionTopics.topicId))
    .where(
      and(
        inArray(
          questions.sheetId,
          early.map((s) => s.sheetId),
        ),
        eq(questions.hintsStatus, "ready"),
      ),
    )
    .orderBy(asc(topics.name));
  const byId = new Map<string, DemoQuestion & { sheetId: string; minutes: number }>();
  for (const { question, topic } of rows) {
    const sheet = early.find((s) => s.sheetId === question.sheetId)!;
    const entry = byId.get(question.id) ?? {
      id: question.id,
      course: sheet.courseId,
      sheet: sheet.n as 1 | 2,
      sheetId: sheet.sheetId,
      position: question.position,
      topics: [],
      minutes: question.expectedMinutes,
    };
    if (topic) entry.topics.push(topic);
    byId.set(question.id, entry);
  }
  const limit = options.questionsPerSheet;
  const chosen = [...byId.values()].filter(
    (q) =>
      limit === undefined ||
      [...byId.values()].filter(
        (o) => o.sheetId === q.sheetId && (o.position ?? 0) < (q.position ?? 0),
      ).length < limit,
  );
  const plan = planDemoHistory(chosen, { seed: options.seed ?? 2026, days: DAYS });
  const description = new Map(DEMO_MISCONCEPTIONS.map((m) => [m.key, m.description]));
  log(`Planned ${plan.length} attempts: ${percent(mix(plan.map((a) => a.outcome)))}`);

  /** Opens an attempt, reveals hints, writes, submits and marks the working. */
  const work = async (
    questionId: string,
    planned: Pick<PlannedAttempt, "outcome" | "misconception" | "hintLevel">,
    sessionId?: string,
  ) => {
    const attempt = await startAttemptFor(userId, questionId, "fresh", sessionId);
    const seen: string[] = [];
    for (let level = 1; level <= planned.hintLevel; level++)
      seen.push((await revealNextHintFor(userId, attempt.id)).body);
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
    const text = await io.write({
      questionBody: question.body,
      outcome: planned.outcome,
      misconception: planned.misconception ? description.get(planned.misconception)! : null,
      hintsSeen: seen,
    });
    await saveDraftText(userId, attempt.id, text);
    const { submissionId } = await submitWorking(userId, attempt.id);
    const claim = await claimMark({ submissionId, basis: "ai" });
    await performMark(claim!, io.mark);
    return attempt.id;
  };

  const attemptIds: string[] = [];
  for (const [i, planned] of plan.entries()) {
    attemptIds.push(await work(planned.questionId, planned));
    if ((i + 1) % 10 === 0) log(`  ${i + 1}/${plan.length} attempts marked (${aiCalls} AI calls)`);
  }

  // 3. Official solutions for sheets 1 and 2, which re-mark every attempt on them.
  for (const s of early.filter((s) => s.answers)) {
    const key = buildKey({
      userId,
      purpose: "official_solutions",
      parentId: s.sheetId,
      mime: "application/pdf",
    });
    await storage.put(key, await readPdf(s.answers!), "application/pdf");
    await startOfficialSolutions(userId, s.sheetId, [{ path: key, mime: "application/pdf" }]);
    await performOfficialRemark(s.sheetId, {
      readFile: storage.get,
      extract: count(ai.extractSolutions),
      mark: io.mark,
    });
    const [after] = await db.select().from(sheets).where(eq(sheets.id, s.sheetId));
    log(`Official solutions for sheet ${s.n}: ${after.solutionsStatus}`);
  }

  // 4. Backdating. A deliberate, dev-script-only exception to "attempts, hint reveals,
  // submitted submissions and marks are append-only" (src/db/schema.ts): the rows were
  // made just now, and are moved to the planned days of the last three weeks, ending
  // now. Only the template user's own rows are touched; app code never does this.
  const end = clock();
  const perDay = new Map<number, number>();
  for (const a of plan) perDay.set(a.day, (perDay.get(a.day) ?? 0) + 1);
  const seenOnDay = new Map<number, number>();
  const startedAt = new Map<string, number>(); // attempt id -> time
  const submittedAt = new Map<string, Date>();
  for (const [i, a] of plan.entries()) {
    const k = seenOnDay.get(a.day) ?? 0;
    seenOnDay.set(a.day, k + 1);
    // Attempts of a day are 40 minutes apart; the day's last one starts 40 minutes before
    // the end of that day (so the newest attempt is from just before now).
    const start = end.getTime() - (DAYS - 1 - a.day) * DAY - (perDay.get(a.day)! - k) * 40 * MIN;
    const factor = { full: 0.9, partial: 1.2, stuck: 1.5 }[a.outcome];
    const seconds = Math.min(30 * 60, Math.round(byId.get(a.questionId)!.minutes * 60 * factor));
    const done = new Date(start + seconds * 1000);
    const attemptId = attemptIds[i];
    startedAt.set(attemptId, start);
    submittedAt.set(attemptId, done);
    await db
      .update(attempts)
      .set({ startedAt: new Date(start), secondsSpent: seconds })
      .where(eq(attempts.id, attemptId));
    const reveals = await db
      .select({ hintId: hintReveals.hintId, level: hints.level })
      .from(hintReveals)
      .innerJoin(hints, eq(hints.id, hintReveals.hintId))
      .where(eq(hintReveals.attemptId, attemptId));
    for (const r of reveals)
      await db
        .update(hintReveals)
        .set({ revealedAt: new Date(start + (seconds * 1000 * r.level) / 4) })
        .where(and(eq(hintReveals.attemptId, attemptId), eq(hintReveals.hintId, r.hintId)));
    await db
      .update(submissions)
      .set({ submittedAt: done, markStatusUpdatedAt: new Date(done.getTime() + MIN) })
      .where(eq(submissions.attemptId, attemptId));
    await backdateMarks([attemptId], "ai", new Date(done.getTime() + MIN));
  }

  // Sheets: uploaded two hours before their first attempt (sheet 3 two days ago); the
  // official solutions two hours after the last submission, but before now.
  for (const s of built) {
    const mine = plan.flatMap((a, i) =>
      byId.get(a.questionId)!.sheetId === s.sheetId ? [attemptIds[i]] : [],
    );
    const uploaded = new Date(
      mine.length
        ? Math.min(...mine.map((id) => startedAt.get(id)!)) - 2 * HOUR
        : end.getTime() - 2 * DAY,
    );
    const official =
      mine.length && s.answers
        ? new Date(
            Math.min(
              Math.max(...mine.map((id) => submittedAt.get(id)!.getTime())) + 2 * HOUR,
              end.getTime() - 6 * MIN,
            ),
          )
        : null;
    await db
      .update(sheets)
      .set({
        uploadedAt: uploaded,
        statusUpdatedAt: new Date(uploaded.getTime() + 2 * MIN),
        ...(official
          ? {
              solutionsUploadedAt: official,
              solutionsStatusUpdatedAt: new Date(official.getTime() + 4 * MIN),
            }
          : {}),
      })
      .where(eq(sheets.id, s.sheetId));
    await db
      .update(questions)
      .set({ hintsStatusUpdatedAt: new Date(uploaded.getTime() + 4 * MIN) })
      .where(eq(questions.sheetId, s.sheetId));
    if (official) await backdateMarks(mine, "official", new Date(official.getTime() + 2 * MIN));
  }
  for (const courseId of courseIds) {
    const [first] = await db
      .select({ at: sheets.uploadedAt })
      .from(sheets)
      .where(eq(sheets.courseId, courseId))
      .orderBy(asc(sheets.uploadedAt))
      .limit(1);
    await db
      .update(courses)
      .set({ createdAt: new Date(first.at.getTime() - HOUR) })
      .where(eq(courses.id, courseId));
  }
  log(`Backdated ${plan.length} attempts to the ${DAYS} days ending ${end.toISOString()}`);

  // 5. Revision: one long-form session in the course with the most to revise, answered.
  const focus = [...courseIds].sort(
    (a, b) =>
      plan.filter((x) => x.course === b && x.outcome !== "full").length -
      plan.filter((x) => x.course === a && x.outcome !== "full").length,
  )[0];
  const revisionSessionId = await optional(log, "revision session", async () => {
    const session = await createRevisionSession(userId, {
      courseId: focus,
      targetMinutes: 30,
      topicIds: null,
    });
    await buildRevisionSession(session.id, io.variant, end);
    const { items } = await getRevisionSession(userId, session.id);
    for (const [i, item] of items.entries())
      await work(
        item.questionId,
        {
          outcome: i % 2 === 0 ? "full" : "partial",
          misconception: i % 2 === 0 ? null : DEMO_MISCONCEPTIONS[i % 3].key,
          hintLevel: 0,
        },
        session.id,
      );
    const [row] = await db
      .select({ status: revisionSessions.status })
      .from(revisionSessions)
      .where(eq(revisionSessions.id, session.id));
    log(`Revision session: ${row.status}, ${items.length} questions answered`);
    return session.id;
  });

  // 6. Common errors, then a 5-question spot-the-error session, answered (one miss).
  for (const courseId of courseIds) await refreshMisconceptions(userId, courseId, io.group);
  const misconceptionCount = (
    await Promise.all(courseIds.map((id) => listMisconceptions(userId, id)))
  ).flat().length;
  const spotSessionId = await optional(log, "spot-the-error session", async () => {
    const session = await createSpotSession(userId, {
      courseId: focus,
      questionCount: 5,
      topicIds: null,
    });
    await buildSpotSession(session.id, io.spot, mulberry32(options.seed ?? 2026));
    const items = await db
      .select()
      .from(spotItems)
      .where(eq(spotItems.sessionId, session.id))
      .orderBy(asc(spotItems.position));
    for (const [k, item] of items.entries()) {
      const miss = item.planted.length === 0 || k === 2;
      const at = new Date();
      await answerSpotItem(
        userId,
        session.id,
        item.position,
        miss
          ? { noError: true, ticked: [] }
          : {
              noError: false,
              ticked: item.planted.map((p) => ({
                line: p.line,
                explanation: p.whatsWrong.slice(0, 500),
              })),
            },
        io.judge,
        at,
      );
      const seconds = 90 + 45 * k;
      await db
        .update(spotAnswers)
        .set({ startedAt: new Date(at.getTime() - seconds * 1000), secondsSpent: seconds })
        .where(eq(spotAnswers.itemId, item.id));
    }
    log(`Spot-the-error session: ${items.length} questions answered`);
    return session.id;
  });

  // 7. The outcome mix the marker actually gave, and the cost.
  const markRows = await db.select().from(marks).where(inArray(marks.attemptId, attemptIds));
  const actual = mix(
    attemptIds.flatMap((id) => {
      const m = currentMark(markRows.filter((r) => r.attemptId === id));
      return m ? [m.outcome] : [];
    }),
  );
  log(`Planned: ${percent(mix(plan.map((a) => a.outcome)))}`);
  log(`Actual:  ${percent(actual)} (${actual.full + actual.partial + actual.stuck} marked)`);
  log(`Common errors: ${misconceptionCount}. AI calls: ${aiCalls}`);

  // 8. Swap: erase the old template, then make the new one the template.
  if (old) {
    log(`Erasing the old template ${old.id}`);
    await options.eraseOld!(old.id);
  }
  await db
    .update(users)
    .set({ email: DEMO_TEMPLATE_EMAIL, demoRole: "template" })
    .where(eq(users.id, userId));
  log(`Template user ${userId} is live`);

  return {
    userId,
    courses: courseIds.length,
    sheets: built.length,
    attempts: plan.length,
    planned: mix(plan.map((a) => a.outcome)),
    actual,
    misconceptions: misconceptionCount,
    revisionSessionId,
    spotSessionId,
    aiCalls,
  };
}

/** Moves the marks of one basis on these attempts to `at`. */
async function backdateMarks(attemptIds: string[], basis: MarkBasis, at: Date) {
  await db
    .update(marks)
    .set({ createdAt: at })
    .where(and(inArray(marks.attemptId, attemptIds), eq(marks.basis, basis)));
}

/** Runs a last step; a failure is reported and leaves the rest of the template in place. */
async function optional<T>(log: (line: string) => void, step: string, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    log(`The ${step} could not be built: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
