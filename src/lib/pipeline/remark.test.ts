import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheetFiles,
  sheets,
  solutions,
  submissions,
  users,
} from "@/db/schema";
import { extractSolutions } from "@/lib/ai/extract-solutions";
import { markAttempt } from "@/lib/ai/mark-attempt";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";
import { NotFoundError } from "@/lib/auth/ownership";
import { STALE_JOB_MS } from "@/lib/domain";

import type { MarkIo } from "./mark";
import {
  performOfficialRemark as runOfficialRemarkAfterStart,
  restartOfficialRemark,
  runOfficialRemark,
  startOfficialSolutions,
  type RemarkIo,
} from "./remark";

type MarkResult = Awaited<ReturnType<MarkIo["mark"]>>;
const markResult = (score: number): MarkResult => ({
  score,
  mistakes: [{ type: "method", quote: "line 2", hint: "h", location: { kind: "text" } }],
  feedback: "f",
  overallFeedback: "o",
});

/** Official scores by question body; every question found in the document unless listed in `missing`. */
function io(
  o: { scores?: Record<string, number>; missing?: string[]; extractFails?: boolean } = {},
) {
  const extract = vi.fn<RemarkIo["extract"]>(async ({ questions: qs }) => {
    if (o.extractFails) throw new Error("boom");
    return {
      solutions: qs
        .filter((q) => !o.missing?.includes(q.label))
        .map((q) => ({ questionId: q.id, body: `official ${q.label}` })),
    };
  });
  const mark = vi.fn<MarkIo["mark"]>(async (i) => markResult(o.scores?.[i.questionBody] ?? 5));
  const value: RemarkIo = {
    readFile: async () => Buffer.from("pdf"),
    extract,
    mark: { readFile: async () => Buffer.from("img"), mark },
  };
  return { value, extract, mark };
}

async function setup(email: string, labels = ["1", "2"]) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const qs = [];
  for (const [i, label] of labels.entries()) {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label,
        body: `Q${label}`,
        expectedMinutes: 5,
      })
      .returning();
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "ai solution" });
    qs.push(q);
  }
  return { user, sheet, qs };
}

/** A submitted attempt left waiting for the official solutions: no mark, no AI call was made. */
async function waiting(userId: string, questionId: string) {
  const [attempt] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({
      attemptId: attempt.id,
      text: "work",
      submittedAt: new Date(),
      markStatus: "awaiting_official",
    })
    .returning();
  return { attempt, submission };
}

const statusOf = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0].markStatus;

/** A submitted attempt with an earlier AI mark of `aiScore`. */
async function submitted(userId: string, questionId: string, aiScore: number, isSubmitted = true) {
  const [attempt] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({
      attemptId: attempt.id,
      text: "work",
      submittedAt: isSubmitted ? new Date() : null,
      markStatus: isSubmitted ? "done" : "none",
    })
    .returning();
  if (isSubmitted) {
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: "ai",
      score: aiScore,
      outcome: aiScore >= 4 ? "full" : aiScore >= 2 ? "partial" : "stuck",
      feedback: "f",
      overallFeedback: "o",
    });
  }
  return { attempt, submission };
}

const addFiles = (sheetId: string) =>
  db
    .insert(sheetFiles)
    .values({ sheetId, kind: "official_solutions", path: "k.pdf", mime: "application/pdf" });

const officialMarks = (attemptId: string) =>
  db
    .select()
    .from(marks)
    .where(and(eq(marks.attemptId, attemptId), eq(marks.basis, "official")));

const sheetRow = async (id: string) => (await db.select().from(sheets).where(eq(sheets.id, id)))[0];

describe("runOfficialRemark", () => {
  it("saves one official solution per question and one official mark per submitted attempt", async () => {
    const { user, sheet, qs } = await setup("rm-basic@test.local");
    await addFiles(sheet.id);
    const a1 = await submitted(user.id, qs[0].id, 3); // ai partial, official full: changed
    const a2 = await submitted(user.id, qs[1].id, 3); // ai partial, official partial: same
    const draft = await submitted(user.id, qs[1].id, 0, false);
    const fake = io({ scores: { Q1: 5, Q2: 3 } });

    await runOfficialRemark(sheet.id, fake.value);

    const official = await db.select().from(solutions).where(eq(solutions.basis, "official"));
    expect(official.filter((s) => qs.some((q) => q.id === s.questionId))).toHaveLength(2);
    const m1 = await officialMarks(a1.attempt.id);
    const m2 = await officialMarks(a2.attempt.id);
    expect(m1).toHaveLength(1);
    expect(m1[0]).toMatchObject({ outcome: "full", outcomeChanged: true });
    expect(m2).toHaveLength(1);
    expect(m2[0]).toMatchObject({ outcome: "partial", outcomeChanged: false });
    expect(await officialMarks(draft.attempt.id)).toHaveLength(0);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
  });

  it("does not mark a question the document has no solution for", async () => {
    const { user, sheet, qs } = await setup("rm-missing@test.local");
    await addFiles(sheet.id);
    const a1 = await submitted(user.id, qs[0].id, 3);
    const a2 = await submitted(user.id, qs[1].id, 3);

    await runOfficialRemark(sheet.id, io({ missing: ["2"] }).value);

    expect(await officialMarks(a1.attempt.id)).toHaveLength(1);
    expect(await officialMarks(a2.attempt.id)).toHaveLength(0);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
  });

  it("creates no duplicates when it runs again", async () => {
    const { user, sheet, qs } = await setup("rm-rerun@test.local");
    await addFiles(sheet.id);
    const a1 = await submitted(user.id, qs[0].id, 3);
    const fake = io();

    await runOfficialRemark(sheet.id, fake.value);
    await runOfficialRemark(sheet.id, fake.value);

    expect(await officialMarks(a1.attempt.id)).toHaveLength(1);
    const rows = await db.select().from(solutions).where(eq(solutions.questionId, qs[0].id));
    expect(rows.filter((s) => s.basis === "official")).toHaveLength(1);
  });

  it("marks again after a new upload", async () => {
    const { user, sheet, qs } = await setup("rm-reupload@test.local");
    const a1 = await submitted(user.id, qs[0].id, 3);
    const fake = io();
    expect(
      await startOfficialSolutions(user.id, sheet.id, [{ path: "a.pdf", mime: "application/pdf" }]),
    ).toBe(true);
    await runOfficialRemarkAfterStart(sheet.id, fake.value);
    expect(
      await startOfficialSolutions(user.id, sheet.id, [{ path: "b.pdf", mime: "application/pdf" }]),
    ).toBe(true);
    await runOfficialRemarkAfterStart(sheet.id, fake.value);

    expect(await officialMarks(a1.attempt.id)).toHaveLength(2);
    const files = await db.select().from(sheetFiles).where(eq(sheetFiles.sheetId, sheet.id));
    expect(files.map((f) => f.path)).toEqual(["b.pdf"]);
  });

  it("is safe when two runs overlap", async () => {
    const { user, sheet, qs } = await setup("rm-overlap@test.local");
    await addFiles(sheet.id);
    const a1 = await submitted(user.id, qs[0].id, 3);
    const a2 = await submitted(user.id, qs[1].id, 3);
    const fake = io();

    await Promise.all([
      runOfficialRemark(sheet.id, fake.value),
      runOfficialRemark(sheet.id, fake.value),
    ]);

    expect(fake.extract).toHaveBeenCalledTimes(1);
    expect(await officialMarks(a1.attempt.id)).toHaveLength(1);
    expect(await officialMarks(a2.attempt.id)).toHaveLength(1);
  });

  it("sets failed when the solutions cannot be read, and a retry works", async () => {
    const { user, sheet, qs } = await setup("rm-fail@test.local");
    await addFiles(sheet.id);
    const a1 = await submitted(user.id, qs[0].id, 3);

    await runOfficialRemark(sheet.id, io({ extractFails: true }).value);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("failed");
    expect(await officialMarks(a1.attempt.id)).toHaveLength(0);

    expect(await restartOfficialRemark(user.id, sheet.id)).toBe(true);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("extracting");
    await runOfficialRemarkAfterStart(sheet.id, io().value);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
    expect(await officialMarks(a1.attempt.id)).toHaveLength(1);
  });

  it("sets failed when a mark fails", async () => {
    const { user, sheet, qs } = await setup("rm-markfail@test.local");
    await addFiles(sheet.id);
    await submitted(user.id, qs[0].id, 3);
    const fake = io();
    fake.mark.mockRejectedValue(new Error("ai down"));

    await runOfficialRemark(sheet.id, fake.value);

    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("failed");
  });

  it("is not claimed while a fresh run is going, but is once that run is stale", async () => {
    const { user, sheet } = await setup("rm-stale@test.local");
    const fake = io();
    await db
      .update(sheets)
      .set({ solutionsStatus: "remarking", solutionsStatusUpdatedAt: new Date() })
      .where(eq(sheets.id, sheet.id));
    expect(await restartOfficialRemark(user.id, sheet.id)).toBe(false);
    expect(
      await startOfficialSolutions(user.id, sheet.id, [{ path: "a.pdf", mime: "application/pdf" }]),
    ).toBe(false);
    expect(await db.select().from(sheetFiles).where(eq(sheetFiles.sheetId, sheet.id))).toHaveLength(
      0,
    );
    expect(fake.extract).not.toHaveBeenCalled();

    await db
      .update(sheets)
      .set({ solutionsStatusUpdatedAt: new Date(Date.now() - STALE_JOB_MS - 1000) })
      .where(eq(sheets.id, sheet.id));
    expect(await restartOfficialRemark(user.id, sheet.id)).toBe(true);
  });

  it("does not let another user start it", async () => {
    const { sheet } = await setup("rm-owner@test.local");
    const [other] = await db.insert(users).values({ email: "rm-other@test.local" }).returning();

    await expect(
      startOfficialSolutions(other.id, sheet.id, [{ path: "a.pdf", mime: "application/pdf" }]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(restartOfficialRemark(other.id, sheet.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("none");
  });

  it("counts the reading and each re-mark as AI calls of a demo copy", async () => {
    const { user, sheet, qs } = await setup("rm-demo@test.local");
    await makeDemoCopy(user.id);
    await addFiles(sheet.id);
    await submitted(user.id, qs[0].id, 3);
    await submitted(user.id, qs[1].id, 3);
    const fake = io();
    vi.stubEnv("AI_FIXTURES", "1");

    // The real AI wrappers answer from fixtures; the fake gives solutions that fit this sheet.
    await runOfficialRemark(sheet.id, {
      ...fake.value,
      extract: async (input) => {
        await extractSolutions(input);
        return fake.value.extract(input);
      },
      mark: { readFile: fake.value.mark.readFile, mark: markAttempt },
    });

    vi.unstubAllEnvs();
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
    expect(await demoCallsOf(user.id)).toBe(3);
  });
});

describe("runOfficialRemark and waiting submissions", () => {
  it("marks each waiting submission against the official solution, with basis official and no AI mark", async () => {
    const { user, sheet, qs } = await setup("rm-wait@test.local");
    await addFiles(sheet.id);
    const w1 = await waiting(user.id, qs[0].id);
    const w2 = await waiting(user.id, qs[1].id);
    const fake = io({ scores: { Q1: 4, Q2: 2 } });

    await runOfficialRemark(sheet.id, fake.value);

    for (const w of [w1, w2]) {
      expect(await statusOf(w.submission.id)).toBe("done");
      const all = await db.select().from(marks).where(eq(marks.attemptId, w.attempt.id));
      expect(all.map((m) => m.basis)).toEqual(["official"]);
    }
    expect((await officialMarks(w1.attempt.id))[0]).toMatchObject({ score: 4, outcome: "full" });
    expect((await officialMarks(w2.attempt.id))[0]).toMatchObject({ score: 2, outcome: "partial" });
    // The first official mark of an attempt did not change an earlier mark's outcome.
    expect((await officialMarks(w1.attempt.id))[0].outcomeChanged).toBe(false);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
  });

  it("marks waiting work alongside the re-marks it already does", async () => {
    const { user, sheet, qs } = await setup("rm-wait-mix@test.local");
    await addFiles(sheet.id);
    const marked = await submitted(user.id, qs[0].id, 3);
    const wait = await waiting(user.id, qs[1].id);

    await runOfficialRemark(sheet.id, io().value);

    expect(await officialMarks(marked.attempt.id)).toHaveLength(1);
    expect(await officialMarks(wait.attempt.id)).toHaveLength(1);
  });

  it("keeps waiting the submission of a question the document has no solution for", async () => {
    const { user, sheet, qs } = await setup("rm-wait-missing@test.local");
    await addFiles(sheet.id);
    const found = await waiting(user.id, qs[0].id);
    const notFound = await waiting(user.id, qs[1].id);
    const fake = io({ missing: ["2"] });

    await runOfficialRemark(sheet.id, fake.value);

    expect(await statusOf(found.submission.id)).toBe("done");
    expect(await statusOf(notFound.submission.id)).toBe("awaiting_official");
    expect(await db.select().from(marks).where(eq(marks.attemptId, notFound.attempt.id))).toEqual(
      [],
    );
    expect(fake.mark).toHaveBeenCalledTimes(1);
    expect((await sheetRow(sheet.id)).solutionsStatus).toBe("done");
  });

  it("is waiting again later: a second upload that does cover the question marks it", async () => {
    const { user, sheet, qs } = await setup("rm-wait-later@test.local");
    const w = await waiting(user.id, qs[1].id);
    await startOfficialSolutions(user.id, sheet.id, [{ path: "a.pdf", mime: "application/pdf" }]);
    await runOfficialRemarkAfterStart(sheet.id, io({ missing: ["2"] }).value);
    expect(await statusOf(w.submission.id)).toBe("awaiting_official");

    await startOfficialSolutions(user.id, sheet.id, [{ path: "b.pdf", mime: "application/pdf" }]);
    await runOfficialRemarkAfterStart(sheet.id, io().value);

    expect(await statusOf(w.submission.id)).toBe("done");
    expect(await officialMarks(w.attempt.id)).toHaveLength(1);
  });

  it("marks only the user's own waiting submissions", async () => {
    const { user, sheet, qs } = await setup("rm-wait-own@test.local");
    const [other] = await db
      .insert(users)
      .values({ email: "rm-wait-other@test.local" })
      .returning();
    await addFiles(sheet.id);
    const mine = await waiting(user.id, qs[0].id);
    const theirs = await waiting(other.id, qs[0].id);

    await runOfficialRemark(sheet.id, io().value);

    expect(await statusOf(mine.submission.id)).toBe("done");
    expect(await statusOf(theirs.submission.id)).toBe("awaiting_official");
  });
});
