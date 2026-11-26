import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { courses, questions, sheets, solutions, users } from "@/db/schema";

import { officialQuestionIds } from "./mark-switch";

describe("officialQuestionIds", () => {
  it("returns only the questions with an official solution", async () => {
    const [user] = await db.insert(users).values({ email: "sw@test.local" }).returning();
    const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
    const [sheet] = await db.insert(sheets).values({ courseId: course.id, title: "S" }).returning();
    const [a, b] = await db
      .insert(questions)
      .values(
        ["1", "2"].map((label, i) => ({
          courseId: course.id,
          sheetId: sheet.id,
          position: i + 1,
          label,
          body: "Q",
          expectedMinutes: 5,
        })),
      )
      .returning();
    await db.insert(solutions).values([
      { questionId: a.id, basis: "official", body: "x" },
      { questionId: b.id, basis: "ai", body: "y" },
    ]);

    expect(await officialQuestionIds([a.id, b.id])).toEqual([a.id]);
    expect(await officialQuestionIds([])).toEqual([]);
  });
});
