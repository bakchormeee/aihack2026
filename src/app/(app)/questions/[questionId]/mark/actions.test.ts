import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheets,
  solutions,
  submissions,
  users,
} from "@/db/schema";
import { setAiClient } from "@/lib/ai/client";
import { demoCallsOf, fakeAi, fixture, makeDemoCopy } from "@/lib/ai/test-helpers";

const signedIn = vi.hoisted(() => ({ id: "" }));
const after = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { markWithAiInsteadAction } from "./actions";

async function waiting(
  email: string,
  o: { markStatus?: "awaiting_official" | "done"; official?: boolean } = {},
) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "Prove P.",
      expectedMinutes: 5,
    })
    .returning();
  await db.insert(solutions).values({ questionId: question.id, basis: "ai", body: "AI solution" });
  if (o.official)
    await db
      .insert(solutions)
      .values({ questionId: question.id, basis: "official", body: "Official solution" });
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({
      attemptId: attempt.id,
      text: "My working",
      submittedAt: new Date(),
      markStatus: o.markStatus ?? "awaiting_official",
    })
    .returning();
  signedIn.id = user.id;
  return { user, question, attempt, submission };
}

const statusOf = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0].markStatus;
const marksOf = (attemptId: string) =>
  db.select().from(marks).where(eq(marks.attemptId, attemptId));

let create: ReturnType<typeof fakeAi>;

beforeEach(() => {
  after.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  create = fakeAi(...Array.from({ length: 4 }, () => fixture("markAttempt")));
});

afterEach(() => {
  setAiClient(null);
  vi.restoreAllMocks();
});

const run = () => Promise.all(after.mock.calls.map(([job]) => job()));

describe("markWithAiInsteadAction", () => {
  it("marks a waiting submission against the AI-written solution", async () => {
    const w = await waiting("mi-ai@test.local");

    await markWithAiInsteadAction(w.question.id, w.attempt.id);
    expect(await statusOf(w.submission.id)).toBe("pending"); // "Marking…" at once
    await run();

    expect(await statusOf(w.submission.id)).toBe("done");
    expect((await marksOf(w.attempt.id)).map((m) => m.basis)).toEqual(["ai"]);
  });

  it("marks against the official solution if it arrived since", async () => {
    const w = await waiting("mi-official@test.local", { official: true });

    await markWithAiInsteadAction(w.question.id, w.attempt.id);
    await run();

    expect((await marksOf(w.attempt.id)).map((m) => m.basis)).toEqual(["official"]);
  });

  it("does nothing for a submission that is not waiting", async () => {
    const w = await waiting("mi-done@test.local", { markStatus: "done" });

    await markWithAiInsteadAction(w.question.id, w.attempt.id);
    await run();

    expect(after).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(await marksOf(w.attempt.id)).toEqual([]);
  });

  it("does nothing when the question does not match the attempt", async () => {
    const w = await waiting("mi-wrong@test.local");

    await markWithAiInsteadAction("another-question", w.attempt.id);

    expect(await statusOf(w.submission.id)).toBe("awaiting_official");
  });

  it("counts as a demo copy's AI call, and does nothing at the limit", async () => {
    const w = await waiting("mi-demo@test.local");
    await makeDemoCopy(w.user.id, 30);
    await markWithAiInsteadAction(w.question.id, w.attempt.id);
    expect(await statusOf(w.submission.id)).toBe("awaiting_official");

    await makeDemoCopy(w.user.id, 28);
    await markWithAiInsteadAction(w.question.id, w.attempt.id);
    await run();
    expect(await statusOf(w.submission.id)).toBe("done");
    expect(await demoCallsOf(w.user.id)).toBeGreaterThan(28);
  });

  it("refuses another user's attempt", async () => {
    const w = await waiting("mi-owner@test.local");
    const other = await waiting("mi-intruder@test.local");
    signedIn.id = other.user.id;

    await expect(markWithAiInsteadAction(w.question.id, w.attempt.id)).rejects.toThrow();
    expect(await statusOf(w.submission.id)).toBe("awaiting_official");
  });
});
