import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { courses, questions, sheets, users } from "@/db/schema";

import { getNextHref } from "./navigation";

async function sheetWith(email: string, count: number) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
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
        body: "B",
        expectedMinutes: 5,
      })),
    )
    .returning();
  rows.sort((a, b) => a.position - b.position);
  return { user, sheet, rows };
}

describe("getNextHref", () => {
  it("goes to the next question on the sheet", async () => {
    const { user, rows } = await sheetWith("nav-next@test.local", 3);

    expect(await getNextHref({ userId: user.id, questionId: rows[0].id })).toBe(
      `/questions/${rows[1].id}`,
    );
  });

  it("goes back to the sheet after the last question", async () => {
    const { user, sheet, rows } = await sheetWith("nav-last@test.local", 2);

    expect(await getNextHref({ userId: user.id, questionId: rows[1].id })).toBe(
      `/sheets/${sheet.id}`,
    );
  });

  it("goes to the revision session page when called inside a session", async () => {
    const { user, rows } = await sheetWith("nav-session@test.local", 2);

    expect(await getNextHref({ userId: user.id, questionId: rows[0].id, sessionId: "abc" })).toBe(
      "/revise/abc",
    );
  });
});
