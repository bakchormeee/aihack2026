import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { courses, questionTopics, questions, sheetFiles, sheets, topics, users } from "@/db/schema";
import { STALE_JOB_MS } from "@/lib/domain";

import {
  checkSheetFileSet,
  createSheetWithFiles,
  keyIsUnder,
  listQuestionsWithTopics,
  listSheets,
  requeueHintsForSheet,
  requeueParse,
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

describe("requeueParse", () => {
  async function sheetWith(email: string, status: "parsing" | "ready" | "failed", ageMs = 0) {
    const { user, course } = await userWithCourse(email);
    const sheet = await createSheetWithFiles(course.id, "S", [
      { path: "p", mime: "application/pdf" },
    ]);
    await db
      .update(sheets)
      .set({
        status,
        statusUpdatedAt: new Date(Date.now() - ageMs),
        error: status === "failed" ? "boom" : null,
      })
      .where(eq(sheets.id, sheet.id));
    return { user, sheet };
  }

  it("restarts a failed sheet and clears its error", async () => {
    const { user, sheet } = await sheetWith("rq-failed@test.local", "failed");

    expect(await requeueParse(user.id, sheet.id)).toBe(true);

    const [row] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
    expect(row.status).toBe("parsing");
    expect(row.error).toBeNull();
  });

  it("restarts a sheet that has been parsing for too long", async () => {
    const { user, sheet } = await sheetWith("rq-stale@test.local", "parsing", STALE_JOB_MS + 1000);

    expect(await requeueParse(user.id, sheet.id)).toBe(true);
  });

  it("leaves a sheet that is still being read", async () => {
    const { user, sheet } = await sheetWith("rq-busy@test.local", "parsing", 1000);

    expect(await requeueParse(user.id, sheet.id)).toBe(false);
  });

  it("leaves a sheet that is already ready", async () => {
    const { user, sheet } = await sheetWith("rq-ready@test.local", "ready");

    expect(await requeueParse(user.id, sheet.id)).toBe(false);
  });

  it("does nothing for another user's failed sheet", async () => {
    const { sheet } = await sheetWith("rq-owner@test.local", "failed");
    const other = await userWithCourse("rq-other@test.local");

    expect(await requeueParse(other.user.id, sheet.id)).toBe(false);
    const [row] = await db.select().from(sheets).where(eq(sheets.id, sheet.id));
    expect(row.status).toBe("failed");
  });
});

describe("listQuestionsWithTopics", () => {
  it("returns the sheet's questions in order with their topics", async () => {
    const { user, course } = await userWithCourse("lq@test.local");
    const sheet = await createSheetWithFiles(course.id, "S", [
      { path: "p", mime: "application/pdf" },
    ]);
    const [t1, t2] = await db
      .insert(topics)
      .values([
        { courseId: course.id, name: "Limits" },
        { courseId: course.id, name: "Series" },
      ])
      .returning();
    const [q2, q1] = await db
      .insert(questions)
      .values([
        {
          courseId: course.id,
          sheetId: sheet.id,
          position: 2,
          label: "2",
          body: "B",
          expectedMinutes: 5,
        },
        {
          courseId: course.id,
          sheetId: sheet.id,
          position: 1,
          label: "1",
          body: "A",
          expectedMinutes: 5,
        },
      ])
      .returning();
    await db.insert(questionTopics).values([
      { questionId: q1.id, topicId: t1.id },
      { questionId: q1.id, topicId: t2.id },
      { questionId: q2.id, topicId: t2.id },
    ]);

    const result = await listQuestionsWithTopics(user.id, sheet.id);

    expect(result.map((q) => q.label)).toEqual(["1", "2"]);
    expect(result[0].topics.map((t) => t.name).sort()).toEqual(["Limits", "Series"]);
    expect(result[1].topics.map((t) => t.name)).toEqual(["Series"]);
  });

  it("returns nothing for another user", async () => {
    const { course } = await userWithCourse("lq-owner@test.local");
    const sheet = await createSheetWithFiles(course.id, "S", [
      { path: "p", mime: "application/pdf" },
    ]);
    await db.insert(questions).values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "A",
      expectedMinutes: 5,
    });
    const other = await userWithCourse("lq-other@test.local");

    expect(await listQuestionsWithTopics(other.user.id, sheet.id)).toEqual([]);
  });
});

describe("requeueHintsForSheet", () => {
  async function sheetWithQuestions(
    email: string,
    specs: { status: "pending" | "ready" | "failed"; ageMs: number }[],
  ) {
    const { user, course } = await userWithCourse(email);
    const sheet = await createSheetWithFiles(course.id, "S", [
      { path: "p", mime: "application/pdf" },
    ]);
    const rows = await db
      .insert(questions)
      .values(
        specs.map((spec, i) => ({
          courseId: course.id,
          sheetId: sheet.id,
          position: i + 1,
          label: String(i + 1),
          body: "B",
          expectedMinutes: 5,
          hintsStatus: spec.status,
          hintsStatusUpdatedAt: new Date(Date.now() - spec.ageMs),
        })),
      )
      .returning();
    return { user, sheet, rows };
  }
  const statuses = async (sheetId: string) =>
    (
      await db
        .select()
        .from(questions)
        .where(eq(questions.sheetId, sheetId))
        .orderBy(questions.position)
    ).map((q) => q.hintsStatus);

  it("restarts failed questions and stuck pending ones, and leaves the rest", async () => {
    const { user, sheet } = await sheetWithQuestions("rh-mix@test.local", [
      { status: "failed", ageMs: 0 },
      { status: "pending", ageMs: STALE_JOB_MS + 1000 },
      { status: "pending", ageMs: 1000 },
      { status: "ready", ageMs: STALE_JOB_MS + 1000 },
    ]);

    expect(await requeueHintsForSheet(user.id, sheet.id)).toBe(2);

    expect(await statuses(sheet.id)).toEqual(["pending", "pending", "pending", "ready"]);
  });

  it("changes nothing for another user's sheet", async () => {
    const { sheet } = await sheetWithQuestions("rh-owner@test.local", [
      { status: "failed", ageMs: 0 },
    ]);
    const other = await userWithCourse("rh-other@test.local");

    expect(await requeueHintsForSheet(other.user.id, sheet.id)).toBe(0);
    expect(await statuses(sheet.id)).toEqual(["failed"]);
  });
});
