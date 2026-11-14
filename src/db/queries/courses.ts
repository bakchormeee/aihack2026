// Course queries (task M1). A course is one university module.

import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses } from "@/db/schema";

export class CourseNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourseNameError";
  }
}

export function normaliseCourseName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new CourseNameError("Enter a course name.");
  if (name.length > 100) throw new CourseNameError("A course name can be at most 100 characters.");
  return name;
}

export async function listCourses(userId: string) {
  return db
    .select()
    .from(courses)
    .where(eq(courses.userId, userId))
    .orderBy(desc(courses.createdAt));
}

export async function createCourse(userId: string, rawName: string) {
  const name = normaliseCourseName(rawName);

  const existing = await db
    .select({ id: courses.id })
    .from(courses)
    .where(sql`${courses.userId} = ${userId} and lower(${courses.name}) = lower(${name})`);
  if (existing.length > 0) throw new CourseNameError("You already have a course with that name.");

  const [course] = await db.insert(courses).values({ userId, name }).returning();
  return course;
}
