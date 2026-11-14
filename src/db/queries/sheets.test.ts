import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { courses, sheetFiles, users } from "@/db/schema";

import {
  checkSheetFileSet,
  createSheetWithFiles,
  keyIsUnder,
  listSheets,
  titleFromFileName,
} from "./sheets";

async function userWithCourse(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Numbers" })
    .returning();
  return { user, course };
}

describe("checkSheetFileSet", () => {
  const pdf = "application/pdf";
  const jpg = "image/jpeg";

  it("accepts one PDF", () => {
    expect(checkSheetFileSet([pdf])).toEqual({ ok: true });
  });

  it("accepts up to 10 images", () => {
    expect(checkSheetFileSet(Array(10).fill(jpg))).toEqual({ ok: true });
  });

  it("rejects 11 images", () => {
    expect(checkSheetFileSet(Array(11).fill(jpg)).ok).toBe(false);
  });

  it("rejects a PDF together with an image", () => {
    expect(checkSheetFileSet([pdf, jpg]).ok).toBe(false);
  });

  it("rejects two PDFs", () => {
    expect(checkSheetFileSet([pdf, pdf]).ok).toBe(false);
  });

  it("rejects no files", () => {
    expect(checkSheetFileSet([]).ok).toBe(false);
  });
});

describe("keyIsUnder", () => {
  it("accepts a key in the user's folder for this purpose and parent", () => {
    expect(keyIsUnder("u/u1/sheet/c1/abc.pdf", "u1", "sheet", "c1")).toBe(true);
  });

  it("rejects a key uploaded for a different course", () => {
    expect(keyIsUnder("u/u1/sheet/c2/abc.pdf", "u1", "sheet", "c1")).toBe(false);
  });

  it("rejects a key uploaded for a different purpose", () => {
    expect(keyIsUnder("u/u1/working/c1/abc.pdf", "u1", "sheet", "c1")).toBe(false);
  });

  it("rejects another user's key and a parent id that is only a prefix", () => {
    expect(keyIsUnder("u/u2/sheet/c1/abc.pdf", "u1", "sheet", "c1")).toBe(false);
    expect(keyIsUnder("u/u1/sheet/c10/abc.pdf", "u1", "sheet", "c1")).toBe(false);
  });
});

describe("titleFromFileName", () => {
  it("drops the extension and tidies separators", () => {
    expect(titleFromFileName("Problem_Sheet-2.pdf")).toBe("Problem Sheet 2");
  });

  it("falls back for a name with nothing usable", () => {
    expect(titleFromFileName(".pdf")).toBe("Untitled sheet");
  });
});

describe("createSheetWithFiles and listSheets", () => {
  it("creates a sheet in status parsing with its files in order", async () => {
    const { course } = await userWithCourse("s-create@test.local");

    const sheet = await createSheetWithFiles(course.id, "Sheet 1", [
      { path: "u/x/sheet/c/a.jpg", mime: "image/jpeg" },
      { path: "u/x/sheet/c/b.jpg", mime: "image/jpeg" },
    ]);

    expect(sheet.status).toBe("parsing");
    expect(sheet.title).toBe("Sheet 1");
    const files = await db
      .select()
      .from(sheetFiles)
      .where(eq(sheetFiles.sheetId, sheet.id))
      .orderBy(sheetFiles.position);
    expect(files.map((f) => [f.kind, f.position, f.path])).toEqual([
      ["sheet", 0, "u/x/sheet/c/a.jpg"],
      ["sheet", 1, "u/x/sheet/c/b.jpg"],
    ]);
  });

  it("lists a course's sheets for its owner, newest first", async () => {
    const { user, course } = await userWithCourse("s-list@test.local");
    const first = await createSheetWithFiles(course.id, "First", [
      { path: "p1", mime: "application/pdf" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createSheetWithFiles(course.id, "Second", [
      { path: "p2", mime: "application/pdf" },
    ]);

    const listed = await listSheets(user.id, course.id);

    expect(listed.map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it("returns nothing to another user", async () => {
    const owner = await userWithCourse("s-owner@test.local");
    const other = await userWithCourse("s-other@test.local");
    await createSheetWithFiles(owner.course.id, "Mine", [{ path: "p", mime: "application/pdf" }]);

    expect(await listSheets(other.user.id, owner.course.id)).toEqual([]);
  });
});
