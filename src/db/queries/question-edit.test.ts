import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  hints,
  questionTopics,
  questions,
  sheets,
  topics,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  EditRuleError,
  deleteQuestion,
  listCourseTopics,
  mergeQuestions,
  splitQuestion,
  topicNamesSchema,
  updateBody,
  updateLabelAndTopics,
} from "./question-edit";

async function setup(
  email: string,
  bodies = ["First question", "Second question", "Third question"],
) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Numbers" })
    .returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "Sheet 1", status: "ready" })
    .returning();
  const [algebra] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Algebra" })
    .returning();
  const [logic] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Logic" })
    .returning();
  const qs = [];
  for (const [i, body] of bodies.entries()) {
    const [q] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: String(i + 1),
        body,
        expectedMinutes: 10,
        hintsStatus: "ready",
      })
      .returning();
    await db
      .insert(questionTopics)
      .values({ questionId: q.id, topicId: i === 1 ? logic.id : algebra.id });
    await db.insert(hints).values({ questionId: q.id, level: 1, body: "old hint" });
    qs.push(q);
  }
  return { user, course, sheet, qs, algebra, logic };
}

async function attempt(userId: string, questionId: string) {
  await db.insert(attempts).values({ userId, questionId, context: "sheet" });
}

async function sheetRows(sheetId: string) {
  return db
    .select()
    .from(questions)
    .where(eq(questions.sheetId, sheetId))
    .orderBy(asc(questions.position));
}

async function topicNames(questionId: string) {
  const rows = await db
    .select({ name: topics.name })
    .from(questionTopics)
    .innerJoin(topics, eq(questionTopics.topicId, topics.id))
    .where(eq(questionTopics.questionId, questionId));
  return rows.map((r) => r.name).sort();
}

describe("ownership", () => {
  it("gives not-found to another user for every action", async () => {
    const a = await setup("owner@test.local");
    const b = await setup("other@test.local");
    const [q1, q2] = a.qs;
    const bad = NotFoundError;
    await expect(
      updateLabelAndTopics(b.user.id, q1.id, { label: "x", topicNames: ["Algebra"] }),
    ).rejects.toThrow(bad);
    await expect(updateBody(b.user.id, q1.id, "hacked")).rejects.toThrow(bad);
    await expect(deleteQuestion(b.user.id, q1.id)).rejects.toThrow(bad);
    await expect(mergeQuestions(b.user.id, q1.id, q2.id)).rejects.toThrow(bad);
    await expect(splitQuestion(b.user.id, q1.id, 3)).rejects.toThrow(bad);
    await expect(listCourseTopics(b.user.id, a.sheet.id)).rejects.toThrow(bad);
    expect((await sheetRows(a.sheet.id)).map((q) => q.body)).toEqual([
      "First question",
      "Second question",
      "Third question",
    ]);
  });
});

describe("sheet status", () => {
  it("rejects every edit while the sheet is not ready", async () => {
    const s = await setup("parsing@test.local");
    await db.update(sheets).set({ status: "parsing" }).where(eq(sheets.id, s.sheet.id));
    const [q1, q2] = s.qs;
    await expect(
      updateLabelAndTopics(s.user.id, q1.id, { label: "x", topicNames: ["Algebra"] }),
    ).rejects.toThrow(EditRuleError);
    await expect(updateBody(s.user.id, q1.id, "new")).rejects.toThrow(EditRuleError);
    await expect(deleteQuestion(s.user.id, q1.id)).rejects.toThrow(EditRuleError);
    await expect(mergeQuestions(s.user.id, q1.id, q2.id)).rejects.toThrow(EditRuleError);
    await expect(splitQuestion(s.user.id, q1.id, 3)).rejects.toThrow(EditRuleError);
  });
});

describe("label and topics", () => {
  it("changes the label and replaces the topics", async () => {
    const s = await setup("label@test.local");
    await updateLabelAndTopics(s.user.id, s.qs[0].id, {
      label: "1(a)",
      topicNames: ["Logic", "Algebra"],
    });
    const [q] = await db.select().from(questions).where(eq(questions.id, s.qs[0].id));
    expect(q.label).toBe("1(a)");
    expect(await topicNames(q.id)).toEqual(["Algebra", "Logic"]);
  });

  it("reuses an existing topic whose name differs only by case", async () => {
    const s = await setup("case@test.local");
    await updateLabelAndTopics(s.user.id, s.qs[0].id, {
      label: "1",
      topicNames: ["  ALGEBRA ", "algebra"],
    });
    const all = await db.select().from(topics).where(eq(topics.courseId, s.course.id));
    expect(all).toHaveLength(2);
    expect(await topicNames(s.qs[0].id)).toEqual(["Algebra"]);
  });

  it("creates a new topic for the course", async () => {
    const s = await setup("new@test.local");
    await updateLabelAndTopics(s.user.id, s.qs[0].id, {
      label: "1",
      topicNames: ["Number theory"],
    });
    expect((await listCourseTopics(s.user.id, s.sheet.id)).map((t) => t.name)).toContain(
      "Number theory",
    );
  });

  it("requires 1 to 3 topics", () => {
    expect(topicNamesSchema.safeParse([]).success).toBe(false);
    expect(topicNamesSchema.safeParse(["a", "b", "c", "d"]).success).toBe(false);
    expect(topicNamesSchema.safeParse(["a", "b", "c"]).success).toBe(true);
  });

  it("is allowed after an attempt, and leaves the body alone", async () => {
    const s = await setup("attempted-label@test.local");
    await attempt(s.user.id, s.qs[0].id);
    await updateLabelAndTopics(s.user.id, s.qs[0].id, { label: "Q1", topicNames: ["Logic"] });
    const [q] = await db.select().from(questions).where(eq(questions.id, s.qs[0].id));
    expect(q.label).toBe("Q1");
    expect(q.body).toBe("First question");
    expect(q.hintsStatus).toBe("ready");
  });
});

describe("body edit", () => {
  it("saves the body, resets hints to pending and keeps the hint rows", async () => {
    const s = await setup("body@test.local");
    const before = new Date(Date.now() - 60_000);
    await db
      .update(questions)
      .set({ hintsStatusUpdatedAt: before })
      .where(eq(questions.id, s.qs[0].id));
    await updateBody(s.user.id, s.qs[0].id, "  Prove that $x^2 \\ge 0$.  ");
    const [q] = await db.select().from(questions).where(eq(questions.id, s.qs[0].id));
    expect(q.body).toBe("Prove that $x^2 \\ge 0$.");
    expect(q.hintsStatus).toBe("pending");
    expect(q.hintsStatusUpdatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(await db.select().from(hints).where(eq(hints.questionId, q.id))).toHaveLength(1);
  });

  it("rejects an empty body", async () => {
    const s = await setup("empty@test.local");
    await expect(updateBody(s.user.id, s.qs[0].id, "   ")).rejects.toThrow();
  });

  it("is rejected once the question has an attempt", async () => {
    const s = await setup("attempted-body@test.local");
    await attempt(s.user.id, s.qs[0].id);
    await expect(updateBody(s.user.id, s.qs[0].id, "changed")).rejects.toThrow(EditRuleError);
    const [q] = await db.select().from(questions).where(eq(questions.id, s.qs[0].id));
    expect(q.body).toBe("First question");
    expect(q.hintsStatus).toBe("ready");
  });
});

describe("delete", () => {
  it("removes the question and renumbers 1..n", async () => {
    const s = await setup("delete@test.local");
    await deleteQuestion(s.user.id, s.qs[1].id);
    const rows = await sheetRows(s.sheet.id);
    expect(rows.map((q) => [q.position, q.label])).toEqual([
      [1, "1"],
      [2, "3"],
    ]);
  });

  it("is rejected once the question has an attempt", async () => {
    const s = await setup("attempted-delete@test.local");
    await attempt(s.user.id, s.qs[1].id);
    await expect(deleteQuestion(s.user.id, s.qs[1].id)).rejects.toThrow(EditRuleError);
    expect(await sheetRows(s.sheet.id)).toHaveLength(3);
  });
});

describe("merge", () => {
  it("joins adjacent questions, keeps first label, unions topics, renumbers, resets hints", async () => {
    const s = await setup("merge@test.local");
    const id = await mergeQuestions(s.user.id, s.qs[0].id, s.qs[1].id);
    expect(id).toBe(s.qs[0].id);
    const rows = await sheetRows(s.sheet.id);
    expect(rows.map((q) => [q.position, q.label])).toEqual([
      [1, "1"],
      [2, "3"],
    ]);
    expect(rows[0].body).toBe("First question\n\nSecond question");
    expect(rows[0].hintsStatus).toBe("pending");
    expect(rows[0].expectedMinutes).toBe(20);
    expect(await topicNames(rows[0].id)).toEqual(["Algebra", "Logic"]);
    expect(await db.select().from(questions).where(eq(questions.id, s.qs[1].id))).toHaveLength(0);
  });

  it("rejects questions that are not adjacent or are in the wrong order", async () => {
    const s = await setup("merge-gap@test.local");
    await expect(mergeQuestions(s.user.id, s.qs[0].id, s.qs[2].id)).rejects.toThrow(EditRuleError);
    await expect(mergeQuestions(s.user.id, s.qs[1].id, s.qs[0].id)).rejects.toThrow(EditRuleError);
  });

  it("rejects questions of two different sheets", async () => {
    const s = await setup("merge-sheets@test.local");
    const [other] = await db
      .insert(sheets)
      .values({ courseId: s.course.id, title: "S2", status: "ready" })
      .returning();
    const [q] = await db
      .insert(questions)
      .values({
        courseId: s.course.id,
        sheetId: other.id,
        position: 2,
        label: "1",
        body: "x",
        expectedMinutes: 5,
      })
      .returning();
    await expect(mergeQuestions(s.user.id, s.qs[0].id, q.id)).rejects.toThrow(EditRuleError);
  });

  it("is rejected when either question has an attempt", async () => {
    const s = await setup("attempted-merge@test.local");
    await attempt(s.user.id, s.qs[1].id);
    await expect(mergeQuestions(s.user.id, s.qs[0].id, s.qs[1].id)).rejects.toThrow(EditRuleError);
    await expect(mergeQuestions(s.user.id, s.qs[1].id, s.qs[2].id)).rejects.toThrow(EditRuleError);
    expect(await sheetRows(s.sheet.id)).toHaveLength(3);
  });
});

describe("split", () => {
  it("cuts the body, labels the second 'b', keeps topics, renumbers, resets hints", async () => {
    const s = await setup("split@test.local", ["Part one. Part two.", "Second", "Third"]);
    const [firstId, secondId] = await splitQuestion(s.user.id, s.qs[0].id, 10);
    expect(firstId).toBe(s.qs[0].id);
    const rows = await sheetRows(s.sheet.id);
    expect(rows.map((q) => [q.position, q.label])).toEqual([
      [1, "1"],
      [2, "1b"],
      [3, "2"],
      [4, "3"],
    ]);
    expect(rows[0].body).toBe("Part one.");
    expect(rows[1].body).toBe("Part two.");
    expect(rows[1].id).toBe(secondId);
    expect(rows[0].hintsStatus).toBe("pending");
    expect(rows[1].hintsStatus).toBe("pending");
    expect(await topicNames(rows[0].id)).toEqual(["Algebra"]);
    expect(await topicNames(rows[1].id)).toEqual(["Algebra"]);
  });

  it("rejects an index outside the text or leaving an empty half", async () => {
    const s = await setup("split-bad@test.local", ["abc   ", "Second"]);
    await expect(splitQuestion(s.user.id, s.qs[0].id, 0)).rejects.toThrow(EditRuleError);
    await expect(splitQuestion(s.user.id, s.qs[0].id, 6)).rejects.toThrow(EditRuleError);
    await expect(splitQuestion(s.user.id, s.qs[0].id, 3)).rejects.toThrow(EditRuleError);
    await expect(splitQuestion(s.user.id, s.qs[0].id, 1.5)).rejects.toThrow(EditRuleError);
  });

  it("is rejected once the question has an attempt", async () => {
    const s = await setup("attempted-split@test.local");
    await attempt(s.user.id, s.qs[0].id);
    await expect(splitQuestion(s.user.id, s.qs[0].id, 3)).rejects.toThrow(EditRuleError);
    expect(await sheetRows(s.sheet.id)).toHaveLength(3);
  });
});
