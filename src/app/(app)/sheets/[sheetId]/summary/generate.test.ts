import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheetSummaries,
  sheets,
  submissions,
  users,
} from "@/db/schema";
import { readSummary } from "@/db/queries/history";
import { currentAiUser } from "@/lib/ai/budget";

const summarise = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/summarise-sheet", () => ({ summariseSheet: summarise }));

import { startSummaryIfNeeded } from "./generate";

const BODY = { wentWell: ["Good on Q1"], wasHard: ["Q2 hints"], nextSteps: ["Redo Q2"] };

async function world(email: string, questionCount = 2) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const ids: string[] = [];
  for (let i = 0; i < questionCount; i++) {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: `${i + 1}`,
        body: "B",
        expectedMinutes: 5,
      })
      .returning();
    ids.push(q.id);
  }
  return { user, sheet, ids };
}

async function mark(userId: string, questionId: string, createdAt = new Date()) {
  const [attempt] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet" })
    .returning();
  await db
    .insert(submissions)
    .values({ attemptId: attempt.id, text: "x", submittedAt: new Date(), markStatus: "done" });
  await db.insert(marks).values({
    attemptId: attempt.id,
    basis: "ai",
    score: 5,
    outcome: "full",
    errorType: null,
    feedback: "f",
    overallFeedback: "o",
    createdAt,
  });
}

/** Runs the scheduled background job to completion, as `after()` would. */
function run() {
  const jobs: Promise<unknown>[] = [];
  return {
    schedule: (fn: () => Promise<void>) => void jobs.push(fn()),
    done: () => Promise.all(jobs),
  };
}

beforeEach(() => {
  summarise.mockReset();
  summarise.mockResolvedValue(BODY);
});

describe("startSummaryIfNeeded", () => {
  it("does nothing until one question has a mark", async () => {
    const w = await world("g-wait@test.local");
    const job = run();

    const state = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);

    expect(state).toEqual({ kind: "waiting", total: 2 });
    await job.done();
    expect(summarise).not.toHaveBeenCalled();
    expect(await db.select().from(sheetSummaries)).toEqual([]);
  });

  it("is written from the first mark, names that question and leaves the others out", async () => {
    const w = await world("g-one@test.local", 3);
    await mark(w.user.id, w.ids[1], new Date(Date.now() - 60_000));
    // A submitted question still waiting for the official solution has no mark and is left out.
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: w.user.id, questionId: w.ids[2], context: "sheet" })
      .returning();
    await db.insert(submissions).values({
      attemptId: attempt.id,
      text: "x",
      submittedAt: new Date(),
      markStatus: "awaiting_official",
    });
    const job = run();

    const state = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(state).toMatchObject({ kind: "generating", covers: "Based on question 2" });
    expect(summarise).toHaveBeenCalledTimes(1);
    expect(summarise.mock.calls[0][0].items).toHaveLength(1);
    expect(summarise.mock.calls[0][0].items[0].label).toBe("2");
  });

  it("is rewritten when a second question gets its mark", async () => {
    const w = await world("g-two@test.local");
    await mark(w.user.id, w.ids[0], new Date(Date.now() - 120_000));
    const job = run();
    await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();
    await mark(w.user.id, w.ids[1], new Date(Date.now() + 5_000));
    const state = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(state).toMatchObject({ kind: "generating", covers: "Based on questions 1 and 2" });
    expect(summarise).toHaveBeenCalledTimes(2);
    expect(summarise.mock.calls[1][0].items).toHaveLength(2);
  });

  it("generates once when marked, even when two page loads race", async () => {
    const w = await world("g-gen@test.local");
    for (const id of w.ids) await mark(w.user.id, id, new Date(Date.now() - 60_000));
    const job = run();

    const [a, b] = await Promise.all([
      startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule),
      startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule),
    ]);
    await job.done();

    expect(summarise).toHaveBeenCalledTimes(1);
    expect(summarise.mock.calls[0][0].items).toHaveLength(2);
    expect([a.kind, b.kind].sort()).toEqual(["generating", "generating"]);
    const after = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    expect(after).toMatchObject({ kind: "ready", body: BODY });
    expect(summarise).toHaveBeenCalledTimes(1);
  });

  it("regenerates when a mark is newer than the stored summary", async () => {
    const w = await world("g-stale@test.local");
    for (const id of w.ids) await mark(w.user.id, id, new Date(Date.now() - 120_000));
    const job = run();
    await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();
    expect(summarise).toHaveBeenCalledTimes(1);

    await mark(w.user.id, w.ids[0], new Date(Date.now() + 5_000)); // a newer mark
    const state = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(state.kind).toBe("generating");
    expect(summarise).toHaveBeenCalledTimes(2);
  });

  it("records a failure instead of retrying on every page load", async () => {
    const w = await world("g-fail@test.local", 1);
    await mark(w.user.id, w.ids[0], new Date(Date.now() - 60_000));
    summarise.mockRejectedValue(new Error("boom"));
    const job = run();

    await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();
    const state = await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(state.kind).toBe("failed");
    expect(summarise).toHaveBeenCalledTimes(1);
    expect((await readSummary(w.user.id, w.sheet.id))?.state).toBe("failed");
  });

  it("gives another user nothing and never calls the AI", async () => {
    const w = await world("g-own@test.local", 1);
    const other = await world("g-own-other@test.local", 1);
    await mark(w.user.id, w.ids[0], new Date(Date.now() - 60_000));
    const job = run();

    const state = await startSummaryIfNeeded(other.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(state.kind).toBe("waiting");
    expect(summarise).not.toHaveBeenCalled();
    expect(
      await db.select().from(sheetSummaries).where(eq(sheetSummaries.sheetId, w.sheet.id)),
    ).toEqual([]);
  });

  it("writes the summary as the student, so a demo copy's AI call is counted", async () => {
    const w = await world("g-user@test.local");
    for (const id of w.ids) await mark(w.user.id, id, new Date(Date.now() - 60_000));
    let aiUser: string | undefined;
    summarise.mockImplementation(async () => {
      aiUser = currentAiUser();
      return BODY;
    });
    const job = run();

    await startSummaryIfNeeded(w.user.id, w.sheet.id, job.schedule);
    await job.done();

    expect(aiUser).toBe(w.user.id);
  });
});
