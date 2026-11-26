import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { attempts, courses, marks, questions, sheets, submissions, users } from "@/db/schema";

const signedIn = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));

import QuestionPage from "./page";

async function world(email: string, labels = ["1"]) {
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
        body: "Prove P.",
        expectedMinutes: 5,
      })
      .returning();
    qs.push(q);
  }
  signedIn.id = user.id;
  return { user, qs };
}

async function attempt(userId: string, questionId: string, startedAt: number, submitted: boolean) {
  const [row] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet", startedAt: new Date(startedAt) })
    .returning();
  await db.insert(submissions).values({
    attemptId: row.id,
    text: "x = 1",
    submittedAt: submitted ? new Date(startedAt + 1000) : null,
    markStatus: submitted ? "done" : "none",
  });
  if (submitted) {
    await db.insert(marks).values({
      attemptId: row.id,
      basis: "ai",
      score: 3,
      outcome: "partial",
      feedback: "f",
      overallFeedback: "o",
    });
  }
  return row;
}

/** Every element in the tree, found by walking props.children (server components are not run). */
function elements(node: ReactNode, found: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((child) => elements(child, found));
  else if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<Record<string, unknown>>;
    found.push(element);
    elements(element.props.children as ReactNode, found);
  }
  return found;
}

const render = (questionId: string, search: Record<string, string> = {}) =>
  QuestionPage({
    params: Promise.resolve({ questionId }),
    searchParams: Promise.resolve(search),
  } as never);

const evaluationOf = (tree: ReactNode) =>
  elements(tree).find((element) => "attemptId" in element.props && "userId" in element.props);

describe("the question page", () => {
  it("shows the evaluation of the newest attempt when it is submitted, with no extra click", async () => {
    const w = await world("qp-new@test.local");
    const old = await attempt(w.user.id, w.qs[0].id, 1_000_000, true);
    const newest = await attempt(w.user.id, w.qs[0].id, 2_000_000, true);

    const evaluation = evaluationOf(await render(w.qs[0].id));

    expect(evaluation?.props.attemptId).toBe(newest.id);
    expect(evaluation?.props.attemptId).not.toBe(old.id);
  });

  it("shows the attempt chosen in the address, and offers the way back to the newest", async () => {
    const w = await world("qp-pick@test.local");
    const old = await attempt(w.user.id, w.qs[0].id, 1_000_000, true);
    await attempt(w.user.id, w.qs[0].id, 2_000_000, true);

    const tree = await render(w.qs[0].id, { attempt: old.id });

    expect(evaluationOf(tree)?.props.attemptId).toBe(old.id);
    const view = elements(tree).find((element) => "newestHref" in element.props);
    expect(view?.props.newestHref).toBe(`/questions/${w.qs[0].id}`);
  });

  it("shows no evaluation while the newest attempt is a draft", async () => {
    const w = await world("qp-draft@test.local");
    await attempt(w.user.id, w.qs[0].id, 1_000_000, true);
    await attempt(w.user.id, w.qs[0].id, 2_000_000, false);

    expect(evaluationOf(await render(w.qs[0].id))).toBeUndefined();
  });

  it("is a 404 for an unknown attempt, another user's attempt and another question's attempt", async () => {
    const w = await world("qp-own@test.local", ["1", "2"]);
    const other = await world("qp-own-other@test.local");
    const theirs = await attempt(other.user.id, other.qs[0].id, 1_000_000, true);
    const second = await attempt(w.user.id, w.qs[1].id, 1_000_000, true);
    signedIn.id = w.user.id;

    for (const id of ["no-such-attempt", theirs.id, second.id]) {
      await expect(render(w.qs[0].id, { attempt: id })).rejects.toMatchObject({
        digest: expect.stringContaining("404"),
      });
    }
  });
});
