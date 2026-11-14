import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { users } from "@/db/schema";

import { CourseNameError, createCourse, listCourses, normaliseCourseName } from "./courses";

async function newUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user;
}

describe("normaliseCourseName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normaliseCourseName("  Analysis   I ")).toBe("Analysis I");
  });

  it("rejects an empty name", () => {
    expect(() => normaliseCourseName("   ")).toThrow(CourseNameError);
  });

  it("rejects a name over 100 characters", () => {
    expect(() => normaliseCourseName("x".repeat(101))).toThrow(CourseNameError);
    expect(normaliseCourseName("x".repeat(100))).toHaveLength(100);
  });
});

describe("createCourse and listCourses", () => {
  it("creates a course that its owner can list", async () => {
    const user = await newUser("c-owner@test.local");

    const course = await createCourse(user.id, "Numbers");

    const listed = await listCourses(user.id);
    expect(listed.map((c) => c.id)).toEqual([course.id]);
    expect(listed[0].name).toBe("Numbers");
  });

  it("does not list another user's courses", async () => {
    const alice = await newUser("c-alice@test.local");
    const bob = await newUser("c-bob@test.local");
    await createCourse(alice.id, "Analysis I");

    expect(await listCourses(bob.id)).toEqual([]);
  });

  it("lists the newest course first", async () => {
    const user = await newUser("c-order@test.local");
    const first = await createCourse(user.id, "First");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createCourse(user.id, "Second");

    expect((await listCourses(user.id)).map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it("refuses a second course with the same name, ignoring case and spacing", async () => {
    const user = await newUser("c-dup@test.local");
    await createCourse(user.id, "Calculus and Applications");

    await expect(createCourse(user.id, "  calculus  AND applications ")).rejects.toThrow(
      CourseNameError,
    );
    expect(await listCourses(user.id)).toHaveLength(1);
  });

  it("allows two different users to use the same course name", async () => {
    const alice = await newUser("c-same-a@test.local");
    const bob = await newUser("c-same-b@test.local");

    await createCourse(alice.id, "Numbers");
    await expect(createCourse(bob.id, "Numbers")).resolves.toBeDefined();
  });
});
