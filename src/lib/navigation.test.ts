import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  questions,
  revisionItems,
  revisionSessions,
  sheets,
  submissions,
  users,
} from "@/db/schema";

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

  describe("inside a revision session", () => {
    async function session(email: string, count: number) {
      const base = await sheetWith(email, count);
      const [s] = await db
        .insert(revisionSessions)
        .values({
          userId: base.user.id,
          courseId: base.rows[0].courseId,
          targetMinutes: 20,
          status: "ready",
        })
        .returning();
      await db.insert(revisionItems).values(
        base.rows.map((q, i) => ({
          sessionId: s.id,
          questionId: q.id,
          position: i + 1,
          source: "retry" as const,
          reason: "r",
        })),
      );
      const submit = async (questionId: string, o: { draft?: boolean; session?: boolean } = {}) => {
        const [a] = await db
          .insert(attempts)
          .values({
            userId: base.user.id,
            questionId,
            context: "revision",
            revisionSessionId: o.session === false ? null : s.id,
          })
          .returning();
        await db
          .insert(submissions)
          .values({ attemptId: a.id, submittedAt: o.draft ? null : new Date() });
      };
      return { ...base, session: s, submit };
    }

    it("goes to the next item that is not done", async () => {
      const { user, rows, session: s, submit } = await session("nav-s1@test.local", 3);
      await submit(rows[0].id);

      expect(await getNextHref({ userId: user.id, questionId: rows[0].id, sessionId: s.id })).toBe(
        `/questions/${rows[1].id}?session=${s.id}`,
      );
    });

    it("skips items that are done and goes back to an earlier one that is not", async () => {
      const { user, rows, session: s, submit } = await session("nav-s2@test.local", 3);
      await submit(rows[1].id);
      await submit(rows[2].id);

      expect(await getNextHref({ userId: user.id, questionId: rows[2].id, sessionId: s.id })).toBe(
        `/questions/${rows[0].id}?session=${s.id}`,
      );
    });

    it("does not count drafts or attempts outside the session as done", async () => {
      const { user, rows, session: s, submit } = await session("nav-s3@test.local", 2);
      await submit(rows[0].id);
      await submit(rows[1].id, { draft: true });
      await submit(rows[1].id, { session: false });

      expect(await getNextHref({ userId: user.id, questionId: rows[0].id, sessionId: s.id })).toBe(
        `/questions/${rows[1].id}?session=${s.id}`,
      );
    });

    it("returns to the session page when every item is done", async () => {
      const { user, rows, session: s, submit } = await session("nav-s4@test.local", 2);
      await submit(rows[0].id);
      await submit(rows[1].id);

      expect(await getNextHref({ userId: user.id, questionId: rows[1].id, sessionId: s.id })).toBe(
        `/revise/${s.id}`,
      );
    });

    it("does not reveal another user's session", async () => {
      const { rows, session: s } = await session("nav-s5@test.local", 2);
      const other = await sheetWith("nav-s5-other@test.local", 1);

      expect(
        await getNextHref({ userId: other.user.id, questionId: other.rows[0].id, sessionId: s.id }),
      ).toBe("/courses");
      void rows;
    });
  });
});
