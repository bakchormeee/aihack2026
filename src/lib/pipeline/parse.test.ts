import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  courses,
  questionTopics,
  questions,
  sheetFiles,
  sheets,
  topicPrereqs,
  topics,
  users,
} from "@/db/schema";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";

import { runParse } from "./parse";

// The AI call runs in fixture mode: tests/fixtures/ai/parseSheet.json has
// 4 questions, topics Product rule, Integration by parts (twice) and
// Eigenvalues and eigenvectors, with parents Differentiation, Integration and
// Linear algebra that are not listed as new topics themselves.

beforeEach(() => {
  process.env.AI_FIXTURES = "1";
});
afterEach(() => {
  delete process.env.AI_FIXTURES;
  vi.restoreAllMocks();
});

const fakeIo = { readFile: async () => Buffer.from("%PDF-fake") };

async function newSheet(email: string, existingTopics: string[] = []) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis I" })
    .returning();
  for (const name of existingTopics) await db.insert(topics).values({ courseId: course.id, name });
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "Sheet" })
    .returning();
  await db
    .insert(sheetFiles)
    .values({ sheetId: sheet.id, kind: "sheet", path: "k.pdf", mime: "application/pdf" });
  return { user, course, sheet };
}

const topicNames = async (courseId: string) =>
  (await db.select().from(topics).where(eq(topics.courseId, courseId))).map((t) => t.name).sort();

describe("runParse", () => {
  it("saves the questions in order and marks the sheet ready", async () => {
    const { course, sheet } = await newSheet("p-ok@test.local");

    await runParse(sheet.id, fakeIo);

    const [row] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
    expect(row.status).toBe("ready");
    expect(row.error).toBeNull();
    const saved = await db
      .select()
      .from(questions)
      .where(eq(questions.sheetId, sheet.id))
      .orderBy(questions.position);
    expect(saved).toHaveLength(4);
    expect(saved.map((q) => q.position)).toEqual([1, 2, 3, 4]);
    expect(saved.every((q) => q.courseId === course.id && q.source === "original")).toBe(true);
    expect(saved.every((q) => q.hintsStatus === "pending")).toBe(true);
  });

  it("creates the topics, including parents that were not listed as new", async () => {
    const { course, sheet } = await newSheet("p-topics@test.local");

    await runParse(sheet.id, fakeIo);

    expect(await topicNames(course.id)).toEqual([
      "Differentiation",
      "Eigenvalues and eigenvectors",
      "Integration",
      "Integration by parts",
      "Linear algebra",
      "Product rule",
    ]);
    const all = await db.select().from(topics).where(eq(topics.courseId, course.id));
    const byName = new Map(all.map((t) => [t.name, t]));
    expect(byName.get("Integration by parts")?.parentId).toBe(byName.get("Integration")?.id);
    expect(byName.get("Integration")?.parentId).toBeNull();
  });

  it("saves prerequisite links and tags every question with its topics", async () => {
    const { course, sheet } = await newSheet("p-links@test.local");

    await runParse(sheet.id, fakeIo);

    const all = await db.select().from(topics).where(eq(topics.courseId, course.id));
    const id = (name: string) => all.find((t) => t.name === name)!.id;
    const prereqs = await db
      .select()
      .from(topicPrereqs)
      .where(eq(topicPrereqs.topicId, id("Integration by parts")));
    expect(prereqs.map((p) => p.prereqId)).toEqual([id("Product rule")]);

    const saved = await db
      .select()
      .from(questions)
      .where(eq(questions.sheetId, sheet.id))
      .orderBy(questions.position);
    const tagged = await db
      .select()
      .from(questionTopics)
      .where(eq(questionTopics.questionId, saved[1].id));
    expect(tagged.map((t) => t.topicId)).toEqual([id("Integration by parts")]);
  });

  it("reuses a topic the course already has, ignoring letter case", async () => {
    const { course, sheet } = await newSheet("p-reuse@test.local", ["product rule"]);

    await runParse(sheet.id, fakeIo);

    const names = await topicNames(course.id);
    expect(names.filter((n) => n.toLowerCase() === "product rule")).toEqual(["product rule"]);
    const rule = (
      await db
        .select()
        .from(topics)
        .where(and(eq(topics.courseId, course.id), eq(topics.name, "product rule")))
    )[0];
    const saved = await db
      .select()
      .from(questions)
      .where(eq(questions.sheetId, sheet.id))
      .orderBy(questions.position);
    const tagged = await db
      .select()
      .from(questionTopics)
      .where(eq(questionTopics.questionId, saved[0].id));
    expect(tagged.map((t) => t.topicId)).toEqual([rule.id]);
  });

  it("does nothing when run a second time", async () => {
    const { sheet } = await newSheet("p-twice@test.local");
    await runParse(sheet.id, fakeIo);

    await runParse(sheet.id, fakeIo);

    const saved = await db.select().from(questions).where(eq(questions.sheetId, sheet.id));
    expect(saved).toHaveLength(4);
  });

  it("saves nothing twice when two runs overlap", async () => {
    const { sheet } = await newSheet("p-race@test.local");

    await Promise.all([runParse(sheet.id, fakeIo), runParse(sheet.id, fakeIo)]);

    const saved = await db.select().from(questions).where(eq(questions.sheetId, sheet.id));
    expect(saved).toHaveLength(4);
    const [row] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
    expect(row.status).toBe("ready");
  });

  it("marks the sheet failed with a readable message when the AI call fails", async () => {
    const { sheet } = await newSheet("p-fail@test.local");
    process.env.AI_FIXTURES = "0";
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runParse(sheet.id, {
      readFile: async () => {
        throw new Error("storage is down");
      },
    });

    const [row] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/could not read/i);
    expect(row.error).not.toMatch(/storage is down/);
    expect(await db.select().from(questions).where(eq(questions.sheetId, sheet.id))).toHaveLength(
      0,
    );
  });

  it("counts one AI call for a demo copy, and fails the sheet once the copy has none left", async () => {
    const { user, sheet } = await newSheet("p-demo@test.local");
    await makeDemoCopy(user.id, 29);

    await runParse(sheet.id, fakeIo);
    expect(await demoCallsOf(user.id)).toBe(30);

    const second = await newSheetFor(user.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runParse(second.id, fakeIo);
    const [row] = await db.select().from(sheets).where(eq(sheets.id, second.id));
    expect(row.status).toBe("failed");
    expect(await demoCallsOf(user.id)).toBe(30);
  });
});

async function newSheetFor(userId: string) {
  const [course] = await db.insert(courses).values({ userId, name: "Numbers" }).returning();
  const [sheet] = await db.insert(sheets).values({ courseId: course.id, title: "S2" }).returning();
  await db
    .insert(sheetFiles)
    .values({ sheetId: sheet.id, kind: "sheet", path: "k2.pdf", mime: "application/pdf" });
  return sheet;
}
