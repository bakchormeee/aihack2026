import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { attempts, courses, questions, sheets, submissions, users } from "@/db/schema";
import { DEMO_AI_LIMIT_MESSAGE } from "@/lib/ai/budget";
import { makeDemoCopy } from "@/lib/ai/test-helpers";

const signedIn = vi.hoisted(() => ({ id: "" }));
const after = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/server", () => ({ after }));

import { submitWorkingAction } from "./submit-actions";

async function draft(email: string) {
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
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({ attemptId: attempt.id, text: "My working" })
    .returning();
  signedIn.id = user.id;
  return { user, attempt, submission };
}

const submissionRow = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0];

beforeEach(() => after.mockReset());

describe("submitWorkingAction and the demo AI limit", () => {
  it("refuses a demo copy with no AI calls left, before anything is submitted", async () => {
    const { user, attempt, submission } = await draft("sw-full@test.local");
    await makeDemoCopy(user.id, 30);

    const result = await submitWorkingAction({ attemptId: attempt.id });

    expect(result).toEqual({ ok: false, error: DEMO_AI_LIMIT_MESSAGE });
    expect((await submissionRow(submission.id)).submittedAt).toBeNull();
    expect(after).not.toHaveBeenCalled();
  });

  it("submits and starts the marking for a copy with calls left, and for a real user", async () => {
    const copy = await draft("sw-left@test.local");
    await makeDemoCopy(copy.user.id, 29);
    expect(await submitWorkingAction({ attemptId: copy.attempt.id })).toEqual({ ok: true });
    expect((await submissionRow(copy.submission.id)).submittedAt).not.toBeNull();

    const real = await draft("sw-real@test.local");
    expect(await submitWorkingAction({ attemptId: real.attempt.id })).toEqual({ ok: true });
    expect(after).toHaveBeenCalledTimes(2);
  });
});
