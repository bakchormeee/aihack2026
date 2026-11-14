import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { attempts, courses, questions, submissions, topics, users } from "@/db/schema";

async function createUserWithCourse(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis 1" })
    .returning();
  return { user, course };
}

describe("test database", () => {
  it("stores and reads back a course for a user", async () => {
    const { user, course } = await createUserWithCourse("read-back@test.local");

    const rows = await db.select().from(courses).where(eq(courses.userId, user.id));

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(course.id);
    expect(rows[0].name).toBe("Analysis 1");
  });

  it("rejects two topics in one course whose names differ only by case", async () => {
    const { course } = await createUserWithCourse("topic-case@test.local");
    await db.insert(topics).values({ courseId: course.id, name: "Limits" });

    await expect(
      db.insert(topics).values({ courseId: course.id, name: "limits" }),
    ).rejects.toThrow();
  });

  it("allows the same topic name in two different courses", async () => {
    const first = await createUserWithCourse("topic-a@test.local");
    const second = await createUserWithCourse("topic-b@test.local");

    await db.insert(topics).values({ courseId: first.course.id, name: "Series" });
    await db.insert(topics).values({ courseId: second.course.id, name: "Series" });

    const rows = await db.select().from(topics).where(eq(topics.name, "Series"));
    expect(rows).toHaveLength(2);
  });

  it("allows only one submission per attempt and starts it as an unmarked draft", async () => {
    const { user, course } = await createUserWithCourse("submission@test.local");
    const [question] = await db
      .insert(questions)
      .values({
        courseId: course.id,
        position: 1,
        label: "1",
        body: "Find $x$.",
        expectedMinutes: 10,
      })
      .returning();
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: question.id, context: "sheet" })
      .returning();

    const [draft] = await db.insert(submissions).values({ attemptId: attempt.id }).returning();

    expect(draft.submittedAt).toBeNull();
    expect(draft.markStatus).toBe("none");
    await expect(db.insert(submissions).values({ attemptId: attempt.id })).rejects.toThrow();
  });
});
