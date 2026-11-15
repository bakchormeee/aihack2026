// Integration test of the template builder: the real pipelines on the in-memory
// database, with AI_FIXTURES answers, a fake storage and a small sheets folder.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  accounts,
  attempts,
  courses,
  hintReveals,
  marks,
  questions,
  revisionSessions,
  sheetFiles,
  sheets,
  spotAnswers,
  spotItems,
  submissions,
  users,
} from "@/db/schema";

import { writeDemoWorking } from "../../../scripts/demo/write-demo-working";

import {
  DEMO_TEMPLATE_EMAIL,
  GAVE_UP_WORKING,
  buildDemoTemplate,
  type BuildDemoOptions,
} from "./build-template";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-15T18:00:00Z");

const root = mkdtempSync(path.join(tmpdir(), "demo-sheets-"));
const pdf = (text: string) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`);
mkdirSync(path.join(root, "Numbers"));
// One file without the .pdf extension, as in the sample folder.
writeFileSync(path.join(root, "Numbers", "Problem Sheet 1"), pdf("sheet 1"));
writeFileSync(path.join(root, "Numbers", "Problem Sheet 1 Solutions.pdf"), pdf("solutions 1"));
mkdirSync(path.join(root, "Empty"));
mkdirSync(path.join(root, "Not a PDF"));
writeFileSync(path.join(root, "Not a PDF", "Problem Sheet 1.pdf"), "hello");

const stored = new Map<string, { body: Buffer; type: string }>();
const storage: BuildDemoOptions["storage"] = {
  put: async (key, body, type) => void stored.set(key, { body, type }),
  get: async (key) => stored.get(key)!.body,
};
const base: BuildDemoOptions = {
  sheetsDir: root,
  storage,
  writeWorking: writeDemoWorking,
  courses: ["Numbers"],
  sheetsPerCourse: 1,
  now: () => NOW,
  log: () => {},
};

/** Frees the email the way E2's eraseDemoUser will, without deleting history rows. */
const eraseOld = vi.fn(async (userId: string) => {
  await db.update(users).set({ email: null }).where(eq(users.id, userId));
});

beforeEach(() => {
  vi.stubEnv("AI_FIXTURES", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildDemoTemplate", () => {
  let firstUserId = "";

  it("builds a template with a course, a parsed sheet and marked, backdated attempts", async () => {
    const report = await buildDemoTemplate(base);
    firstUserId = report.userId;

    const [user] = await db.select().from(users).where(eq(users.id, report.userId));
    expect(user).toMatchObject({ email: DEMO_TEMPLATE_EMAIL, demoRole: "template" });
    expect(await db.select().from(accounts).where(eq(accounts.userId, user.id))).toEqual([]);

    const [course] = await db.select().from(courses).where(eq(courses.userId, user.id));
    expect(course.name).toBe("Numbers");
    const [sheet] = await db.select().from(sheets).where(eq(sheets.courseId, course.id));
    expect(sheet).toMatchObject({ title: "Problem Sheet 1", status: "ready" });
    expect(sheet.solutionsStatus).toBe("done");
    const sheetQuestions = await db.select().from(questions).where(eq(questions.sheetId, sheet.id));
    expect(sheetQuestions).toHaveLength(4);
    expect(sheetQuestions.every((q) => q.hintsStatus === "ready")).toBe(true);

    // Files under the template user's own folder, as the app's keys are.
    const files = await db.select().from(sheetFiles).where(eq(sheetFiles.sheetId, sheet.id));
    expect(files.map((f) => f.kind).sort()).toEqual(["official_solutions", "sheet"]);
    for (const f of files) {
      const parent = f.kind === "sheet" ? course.id : sheet.id;
      expect(f.path.startsWith(`u/${user.id}/${f.kind}/${parent}/`)).toBe(true);
      expect(stored.get(f.path)!.type).toBe("application/pdf");
    }

    // Every planned attempt is submitted and marked by the AI and against the official solutions.
    const sheetAttempts = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, user.id), eq(attempts.context, "sheet")));
    expect(sheetAttempts).toHaveLength(report.attempts);
    expect(report.attempts).toBe(5); // 4 questions and one repeat
    const ids = sheetAttempts.map((a) => a.id);
    const subs = await db.select().from(submissions).where(inArray(submissions.attemptId, ids));
    const markRows = await db.select().from(marks).where(inArray(marks.attemptId, ids));
    expect(markRows.filter((m) => m.basis === "ai")).toHaveLength(5);
    expect(markRows.filter((m) => m.basis === "official")).toHaveLength(5);
    expect(report.actual.full + report.actual.partial + report.actual.stuck).toBe(5);

    // Backdated: spread over the last three weeks, ending just before now, in order.
    const starts = sheetAttempts.map((a) => a.startedAt.getTime());
    expect(Math.min(...starts)).toBeLessThan(NOW.getTime() - 19 * DAY);
    expect(Math.max(...starts)).toBeGreaterThan(NOW.getTime() - DAY);
    for (const a of sheetAttempts) {
      const sub = subs.find((s) => s.attemptId === a.id)!;
      expect(sub.submittedAt!.getTime()).toBeGreaterThan(a.startedAt.getTime());
      expect(sub.submittedAt!.getTime()).toBeLessThan(NOW.getTime());
      expect(a.secondsSpent).toBeGreaterThan(0);
      for (const m of markRows.filter((r) => r.attemptId === a.id)) {
        expect(m.createdAt.getTime()).toBeGreaterThan(sub.submittedAt!.getTime());
        expect(m.createdAt.getTime()).toBeLessThan(NOW.getTime());
      }
    }
    const official = markRows.find((m) => m.basis === "official")!;
    expect(sheet.solutionsUploadedAt!.getTime()).toBeLessThan(official.createdAt.getTime());
    expect(sheet.uploadedAt.getTime()).toBeLessThan(Math.min(...starts));
    expect(course.createdAt.getTime()).toBeLessThan(sheet.uploadedAt.getTime());

    const reveals = await db.select().from(hintReveals).where(inArray(hintReveals.attemptId, ids));
    expect(reveals.length).toBeGreaterThan(0);
    for (const r of reveals) {
      const a = sheetAttempts.find((x) => x.id === r.attemptId)!;
      const sub = subs.find((s) => s.attemptId === a.id)!;
      expect(r.revealedAt.getTime()).toBeGreaterThan(a.startedAt.getTime());
      expect(r.revealedAt.getTime()).toBeLessThanOrEqual(sub.submittedAt!.getTime());
    }

    // Common errors, and one finished session of each revision kind.
    expect(report.misconceptions).toBeGreaterThan(0);
    const [revision] = await db
      .select()
      .from(revisionSessions)
      .where(eq(revisionSessions.id, report.revisionSessionId!));
    expect(revision).toMatchObject({ mode: "long_form", status: "ready" });
    const revisionAttempts = await db
      .select()
      .from(attempts)
      .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
      .where(and(eq(attempts.revisionSessionId, revision.id), isNotNull(submissions.submittedAt)));
    expect(revisionAttempts.length).toBeGreaterThan(0);

    const items = await db
      .select()
      .from(spotItems)
      .where(eq(spotItems.sessionId, report.spotSessionId!));
    expect(items).toHaveLength(5);
    const answers = await db
      .select()
      .from(spotAnswers)
      .where(
        inArray(
          spotAnswers.itemId,
          items.map((i) => i.id),
        ),
      );
    expect(answers.every((a) => a.outcome !== null && a.secondsSpent! > 0)).toBe(true);

    expect(report).toMatchObject({ courses: 1, sheets: 1 });
    expect(report.aiCalls).toBeGreaterThan(10);
  });

  it("erases the old template through eraseOld before building again, and reports a step that fails", async () => {
    const log = vi.fn();
    const report = await buildDemoTemplate({
      ...base,
      eraseOld,
      log,
      // No common errors: the spot-the-error session cannot be built.
      ai: { groupMisconceptions: async () => [] },
    });

    expect(eraseOld).toHaveBeenCalledWith(firstUserId);
    expect(report.userId).not.toBe(firstUserId);
    expect(report.spotSessionId).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("spot-the-error session could not be built"),
    );
  });

  it("answers only the first questions of each sheet when asked", async () => {
    const report = await buildDemoTemplate({ ...base, eraseOld, questionsPerSheet: 2 });
    const planned = report.planned.full + report.planned.partial + report.planned.stuck;
    expect(report.attempts).toBe(planned);
    // 2 questions, plus at most one repeat each.
    expect(report.attempts).toBeGreaterThanOrEqual(2);
    expect(report.attempts).toBeLessThanOrEqual(4);
  });

  it("tries a failed answer three times, then submits a stuck answer and carries on", async () => {
    const writeWorking = vi.fn(async () => {
      throw new Error("unclosed $");
    });
    const report = await buildDemoTemplate({
      ...base,
      eraseOld,
      questionsPerSheet: 1,
      officialSolutions: false,
      writeWorking,
    });
    const texts = await db
      .select({ text: submissions.text })
      .from(submissions)
      .innerJoin(attempts, eq(attempts.id, submissions.attemptId))
      .where(eq(attempts.userId, report.userId));
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t.text === GAVE_UP_WORKING)).toBe(true);
    expect(writeWorking.mock.calls.length).toBe(3 * texts.length);
  });

  it("skips the official solutions when asked, keeping only the AI marks", async () => {
    const report = await buildDemoTemplate({ ...base, eraseOld, officialSolutions: false });
    const sheetRows = await db
      .select()
      .from(sheets)
      .innerJoin(courses, eq(courses.id, sheets.courseId))
      .where(eq(courses.userId, report.userId));
    expect(sheetRows.every((r) => r.sheet.solutionsStatus === "none")).toBe(true);
  });

  it("builds two courses with three sheets each, leaving sheet 3 unattempted", async () => {
    const wide = mkdtempSync(path.join(tmpdir(), "demo-sheets-"));
    for (const [course, names] of [
      ["Numbers", ["Problem Sheet 1.pdf", "Problem Sheet 2.pdf", "Problem Sheet 3.pdf"]],
      // No answers for sheet 1; sheet 2's answers file has no extension.
      [
        "Analysis I",
        [
          "Problem Sheet 1",
          "Problem Sheet 2.pdf",
          "Problem Sheet 2 Answers",
          "Problem Sheet 3.pdf",
        ],
      ],
    ] as const) {
      mkdirSync(path.join(wide, course));
      for (const name of names) writeFileSync(path.join(wide, course, name), pdf(name));
    }
    writeFileSync(path.join(wide, "Numbers", "Problem Sheet 1 - Answers.pdf"), pdf("answers"));

    const report = await buildDemoTemplate({
      ...base,
      sheetsDir: wide,
      courses: ["Numbers", "Analysis I"],
      sheetsPerCourse: 3,
      eraseOld,
    });
    expect(report).toMatchObject({ courses: 2, sheets: 6 });

    const rows = await db
      .select({ sheet: sheets, course: courses.name })
      .from(sheets)
      .innerJoin(courses, eq(courses.id, sheets.courseId))
      .where(eq(courses.userId, report.userId));
    const title = (course: string, n: number) =>
      rows.find((r) => r.course === course && r.sheet.title === `Problem Sheet ${n}`)!.sheet;
    expect(title("Numbers", 1).solutionsStatus).toBe("done");
    expect(title("Analysis I", 1).solutionsStatus).toBe("none");
    expect(title("Analysis I", 2).solutionsStatus).toBe("done");
    expect(title("Numbers", 3).solutionsStatus).toBe("none");

    const made = await db
      .select({ attempt: attempts, sheetId: questions.sheetId })
      .from(attempts)
      .innerJoin(questions, eq(questions.id, attempts.questionId))
      .where(and(eq(attempts.userId, report.userId), eq(attempts.context, "sheet")));
    for (const course of ["Numbers", "Analysis I"]) {
      // The first attempt at each question of the sheet (a repeat may come later).
      const on = (n: number) => {
        const first = new Map<string, number>();
        for (const m of made.filter((x) => x.sheetId === title(course, n).id)) {
          const t = m.attempt.startedAt.getTime();
          first.set(m.attempt.questionId, Math.min(t, first.get(m.attempt.questionId) ?? t));
        }
        return [...first.values()];
      };
      expect(on(3)).toEqual([]);
      expect(Math.max(...on(1))).toBeLessThan(Math.min(...on(2)));
      expect(title(course, 3).uploadedAt.getTime()).toBe(NOW.getTime() - 2 * DAY);
    }
  });

  it("refuses to build over an existing template without eraseOld", async () => {
    await expect(buildDemoTemplate(base)).rejects.toThrow(/already exists/);
  });

  it("refuses a missing sheet, a file that is not a PDF, and bad options", async () => {
    await expect(buildDemoTemplate({ ...base, eraseOld, courses: ["Empty"] })).rejects.toThrow(
      /No "Problem Sheet 1"/,
    );
    await expect(buildDemoTemplate({ ...base, eraseOld, courses: ["Not a PDF"] })).rejects.toThrow(
      /is not a PDF/,
    );
    await expect(buildDemoTemplate({ ...base, sheetsPerCourse: 4 })).rejects.toThrow(/1 to 3/);
    await expect(buildDemoTemplate({ ...base, courses: [] })).rejects.toThrow(/at least one/);
  });
});
