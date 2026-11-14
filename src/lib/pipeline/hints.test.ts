import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, hints, questions, sheets, solutions, users } from "@/db/schema";

import { runHints, runHintsForSheet, type HintsIo } from "./hints";

const generated = {
  hints: [
    "Think about the definition.",
    "Use the epsilon-N definition with epsilon = 1.",
    "1. Fix epsilon. 2. Bound the tail. 3. Take a maximum.",
  ] as [string, string, string],
  solution: "Full solution with $\\varepsilon = 1$.",
  finalAnswer: "bounded",
};
const okIo: HintsIo = { generate: async () => generated };

async function newQuestions(email: string, count = 1) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis I" })
    .returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const rows = await db
    .insert(questions)
    .values(
      Array.from({ length: count }, (_, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: String(i + 1),
        body: `Question ${i + 1}`,
        expectedMinutes: 10,
      })),
    )
    .returning();
  return { sheet, rows };
}

const statusOf = async (id: string) =>
  (await db.select().from(questions).where(eq(questions.id, id)))[0].hintsStatus;

describe("runHints", () => {
  it("saves three hints in order and the AI solution, and marks the question ready", async () => {
    const { rows } = await newQuestions("h-ok@test.local");

    await runHints(rows[0].id, okIo);

    const saved = await db
      .select()
      .from(hints)
      .where(eq(hints.questionId, rows[0].id))
      .orderBy(hints.level);
    expect(saved.map((h) => [h.level, h.body])).toEqual([
      [1, generated.hints[0]],
      [2, generated.hints[1]],
      [3, generated.hints[2]],
    ]);
    const [solution] = await db
      .select()
      .from(solutions)
      .where(eq(solutions.questionId, rows[0].id));
    expect(solution.basis).toBe("ai");
    expect(solution.body).toBe(generated.solution);
    expect(await statusOf(rows[0].id)).toBe("ready");
  });

  it("does nothing for a question that is already ready", async () => {
    const { rows } = await newQuestions("h-twice@test.local");
    await runHints(rows[0].id, okIo);
    const generate = vi.fn(okIo.generate);

    await runHints(rows[0].id, { generate });

    expect(generate).not.toHaveBeenCalled();
    expect(await db.select().from(hints).where(eq(hints.questionId, rows[0].id))).toHaveLength(3);
  });

  it("creates no duplicates when two runs overlap", async () => {
    const { rows } = await newQuestions("h-race@test.local");

    await Promise.all([runHints(rows[0].id, okIo), runHints(rows[0].id, okIo)]);

    expect(await db.select().from(hints).where(eq(hints.questionId, rows[0].id))).toHaveLength(3);
    expect(
      await db.select().from(solutions).where(eq(solutions.questionId, rows[0].id)),
    ).toHaveLength(1);
  });

  it("marks the question failed, saving nothing, when the AI call throws", async () => {
    const { rows } = await newQuestions("h-fail@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runHints(rows[0].id, {
      generate: async () => {
        throw new Error("api down");
      },
    });

    expect(await statusOf(rows[0].id)).toBe("failed");
    expect(await db.select().from(hints).where(eq(hints.questionId, rows[0].id))).toHaveLength(0);
  });

  it("replaces the hints and solution when it is run again after the question was reset", async () => {
    const { rows } = await newQuestions("h-redo@test.local");
    await runHints(rows[0].id, okIo);
    await db.update(questions).set({ hintsStatus: "pending" }).where(eq(questions.id, rows[0].id));

    await runHints(rows[0].id, {
      generate: async () => ({
        ...generated,
        hints: ["New 1", "New 2", "New 3"],
        solution: "New solution",
      }),
    });

    const saved = await db
      .select()
      .from(hints)
      .where(eq(hints.questionId, rows[0].id))
      .orderBy(hints.level);
    expect(saved.map((h) => h.body)).toEqual(["New 1", "New 2", "New 3"]);
    const [solution] = await db
      .select()
      .from(solutions)
      .where(eq(solutions.questionId, rows[0].id));
    expect(solution.body).toBe("New solution");
  });
});

describe("runHintsForSheet", () => {
  it("prepares every pending question, never running more than five at once", async () => {
    const { sheet, rows } = await newQuestions("h-sheet@test.local", 12);
    let running = 0;
    let peak = 0;

    await runHintsForSheet(sheet.id, {
      generate: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return generated;
      },
    });

    for (const row of rows) expect(await statusOf(row.id)).toBe("ready");
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("carries on with the other questions when one fails", async () => {
    const { sheet, rows } = await newQuestions("h-partial@test.local", 3);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runHintsForSheet(sheet.id, {
      generate: async ({ questionBody }) => {
        if (questionBody === "Question 2") throw new Error("bad");
        return generated;
      },
    });

    expect(await Promise.all(rows.map((r) => statusOf(r.id)))).toEqual([
      "ready",
      "failed",
      "ready",
    ]);
  });

  it("skips questions that are already ready", async () => {
    const { sheet, rows } = await newQuestions("h-skip@test.local", 2);
    await runHints(rows[0].id, okIo);
    const generate = vi.fn(okIo.generate);

    await runHintsForSheet(sheet.id, { generate });

    expect(generate).toHaveBeenCalledTimes(1);
  });
});
