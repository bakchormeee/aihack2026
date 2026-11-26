import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { courses, questions, sheetFiles, sheets, solutions, users } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import { getOfficialSolutions } from "./official-solutions";

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db.insert(sheets).values({ courseId: course.id, title: "S" }).returning();
  const [q2, q1, q3] = await db
    .insert(questions)
    .values(
      [
        { label: "2", position: 2 },
        { label: "1", position: 1 },
        { label: "3", position: 3 },
      ].map((q) => ({
        ...q,
        courseId: course.id,
        sheetId: sheet.id,
        body: `Question ${q.label}`,
        expectedMinutes: 5,
      })),
    )
    .returning();
  return { user, sheet, q1, q2, q3 };
}

describe("getOfficialSolutions", () => {
  it("lists every question in sheet order with its official solution, or null when it has none", async () => {
    const { user, sheet, q1, q2, q3 } = await setup("os-list@test.local");
    await db.insert(solutions).values([
      { questionId: q1.id, basis: "official", body: "Official 1" },
      { questionId: q1.id, basis: "ai", body: "AI 1" },
      { questionId: q2.id, basis: "ai", body: "AI 2" },
      { questionId: q3.id, basis: "official", body: "Official 3" },
    ]);

    const result = await getOfficialSolutions(user.id, sheet.id);

    expect(result.questions).toEqual([
      { id: q1.id, label: "1", body: "Question 1", solution: "Official 1" },
      { id: q2.id, label: "2", body: "Question 2", solution: null },
      { id: q3.id, label: "3", body: "Question 3", solution: "Official 3" },
    ]);
  });

  it("lists the uploaded official-solution files in order, not the sheet's own file", async () => {
    const { user, sheet } = await setup("os-files@test.local");
    const [, second, first] = await db
      .insert(sheetFiles)
      .values([
        { sheetId: sheet.id, kind: "sheet", path: "u/x/sheet.pdf", mime: "application/pdf" },
        {
          sheetId: sheet.id,
          kind: "official_solutions",
          path: "u/x/b.jpg",
          mime: "image/jpeg",
          position: 1,
        },
        {
          sheetId: sheet.id,
          kind: "official_solutions",
          path: "u/x/a.jpg",
          mime: "image/jpeg",
          position: 0,
        },
      ])
      .returning();

    const result = await getOfficialSolutions(user.id, sheet.id);

    expect(result.files).toEqual([
      { id: first.id, mime: "image/jpeg" },
      { id: second.id, mime: "image/jpeg" },
    ]);
  });

  it("refuses another user's sheet", async () => {
    const owner = await setup("os-owner@test.local");
    const other = await setup("os-other@test.local");
    await expect(getOfficialSolutions(other.user.id, owner.sheet.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
