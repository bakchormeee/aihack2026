import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { attempts, courses, marks, questions, sheets, submissions, users } from "@/db/schema";

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { AttemptEvaluation } from "./attempt-evaluation";

async function world(
  email: string,
  markStatus: "none" | "pending" | "done" | "failed",
  mark = true,
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
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  await db.insert(submissions).values({
    attemptId: attempt.id,
    text: "x = 1",
    submittedAt: new Date(),
    markStatus,
  });
  if (mark) {
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: "ai",
      score: 3,
      outcome: "partial",
      errorType: "method",
      feedback: "Check the second line.",
      overallFeedback: "Nearly there.",
    });
  }
  return { user, question, attempt };
}

const html = async (w: Awaited<ReturnType<typeof world>>) =>
  renderToStaticMarkup(
    (await AttemptEvaluation({
      userId: w.user.id,
      question: w.question,
      attemptId: w.attempt.id,
    })) as React.ReactElement,
  );

describe("AttemptEvaluation", () => {
  it("shows the mark and the feedback of a marked attempt", async () => {
    const out = await html(await world("ae-done@test.local", "done"));
    expect(out).toContain("3/5");
    expect(out).toContain("Check the second line.");
    expect(out).toContain("Retry now");
  });

  it("shows the waiting state while the AI marks", async () => {
    const out = await html(await world("ae-pending@test.local", "pending", false));
    expect(out).toContain("Marking your working…");
  });

  it("offers to mark again when marking failed", async () => {
    const out = await html(await world("ae-failed@test.local", "failed", false));
    expect(out).toContain("We could not mark your working.");
    expect(out).toContain("Mark my working");
  });

  it("shows nothing for an attempt at another question", async () => {
    const w = await world("ae-other@test.local", "done");
    const out = await AttemptEvaluation({
      userId: w.user.id,
      question: { id: "another-question", hintsStatus: "ready" },
      attemptId: w.attempt.id,
    });
    expect(out).toBeNull();
  });
});
