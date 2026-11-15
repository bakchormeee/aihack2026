import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, sheets, users } from "@/db/schema";

const signedIn = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { restoreCourseAction, restoreSheetAction } from "./actions";

async function binnedWorld(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const deletedAt = new Date();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "C", deletedAt })
    .returning();
  const [live] = await db.insert(courses).values({ userId: user.id, name: "L" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: live.id, title: "S", deletedAt })
    .returning();
  return { user, course, sheet };
}
const courseRow = async (id: string) =>
  (await db.select().from(courses).where(eq(courses.id, id)))[0];
const sheetRow = async (id: string) => (await db.select().from(sheets).where(eq(sheets.id, id)))[0];

describe("restore actions", () => {
  it("restore a binned course and a binned sheet of the user", async () => {
    const w = await binnedWorld("ra-own@test.local");
    signedIn.id = w.user.id;

    await restoreCourseAction(w.course.id);
    await restoreSheetAction(w.sheet.id);

    expect((await courseRow(w.course.id)).deletedAt).toBeNull();
    expect((await sheetRow(w.sheet.id)).deletedAt).toBeNull();
  });

  it("show the 404 page for another user's items and change nothing", async () => {
    const w = await binnedWorld("ra-owner@test.local");
    const other = await binnedWorld("ra-other@test.local");
    signedIn.id = other.user.id;

    await expect(restoreCourseAction(w.course.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(restoreSheetAction(w.sheet.id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await courseRow(w.course.id)).deletedAt).toBeInstanceOf(Date);
    expect((await sheetRow(w.sheet.id)).deletedAt).toBeInstanceOf(Date);
  });
});
