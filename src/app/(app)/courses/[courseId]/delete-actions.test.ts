import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, sheets, users } from "@/db/schema";

const signedIn = vi.hoisted(() => ({ id: "" }));
const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect, notFound }));

import { deleteCourseAction, deleteSheetAction } from "./delete-actions";

async function world(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db.insert(sheets).values({ courseId: course.id, title: "S" }).returning();
  return { user, course, sheet };
}
const courseRow = async (id: string) =>
  (await db.select().from(courses).where(eq(courses.id, id)))[0];
const sheetRow = async (id: string) => (await db.select().from(sheets).where(eq(sheets.id, id)))[0];

beforeEach(() => redirect.mockClear());

describe("deleteCourseAction", () => {
  it("bins the course and opens the courses list with the notice", async () => {
    const w = await world("da-course@test.local");
    signedIn.id = w.user.id;

    await deleteCourseAction(w.course.id);

    expect((await courseRow(w.course.id)).deletedAt).toBeInstanceOf(Date);
    expect(redirect).toHaveBeenCalledWith("/courses?deleted=1");
  });

  it("shows the 404 page for another user's course and changes nothing", async () => {
    const w = await world("da-course-owner@test.local");
    const other = await world("da-course-other@test.local");
    signedIn.id = other.user.id;

    await expect(deleteCourseAction(w.course.id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await courseRow(w.course.id)).deletedAt).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("deleteSheetAction", () => {
  it("bins the sheet and opens its course with the notice", async () => {
    const w = await world("da-sheet@test.local");
    signedIn.id = w.user.id;

    await deleteSheetAction(w.sheet.id);

    expect((await sheetRow(w.sheet.id)).deletedAt).toBeInstanceOf(Date);
    expect(redirect).toHaveBeenCalledWith(`/courses/${w.course.id}?deleted=1`);
  });

  it("shows the 404 page for another user's sheet and changes nothing", async () => {
    const w = await world("da-sheet-owner@test.local");
    const other = await world("da-sheet-other@test.local");
    signedIn.id = other.user.id;

    await expect(deleteSheetAction(w.sheet.id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await sheetRow(w.sheet.id)).deletedAt).toBeNull();
  });
});
