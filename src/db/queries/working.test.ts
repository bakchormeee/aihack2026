import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  questions,
  sheets,
  submissionFiles,
  submissions,
  users,
} from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";

import {
  EmptyWorkingError,
  SubmissionLockedError,
  WorkingFilesError,
  addDraftFiles,
  getWorkingFor,
  removeDraftFile,
  saveDraftText,
  submitAllDrafts,
  submitWorking,
} from "./working";

const pdf = (n = 1) => ({ path: `k/${n}.pdf`, mime: "application/pdf" });
const jpg = (n = 1) => ({ path: `k/${n}.jpg`, mime: "image/jpeg" });

async function setup(email: string, questionCount = 1) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const qs = await db
    .insert(questions)
    .values(
      Array.from({ length: questionCount }, (_, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: String(i + 1),
        body: "Q",
        expectedMinutes: 5,
      })),
    )
    .returning();
  const made = await db
    .insert(attempts)
    .values(qs.map((q) => ({ userId: user.id, questionId: q.id, context: "sheet" as const })))
    .returning();
  return { user, sheet, attempts: made };
}

describe("saveDraftText", () => {
  it("creates a draft submission with the text", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("w-text@test.local");

    await saveDraftText(user.id, attempt.id, "Let $x = 1$.");

    const work = await getWorkingFor(user.id, attempt.id);
    expect(work.text).toBe("Let $x = 1$.");
    expect(work.submittedAt).toBeNull();
  });

  it("updates the same draft instead of creating another", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("w-update@test.local");
    await saveDraftText(user.id, attempt.id, "first");
    await saveDraftText(user.id, attempt.id, "second");

    expect((await getWorkingFor(user.id, attempt.id)).text).toBe("second");
    expect(
      await db.select().from(submissions).where(eq(submissions.attemptId, attempt.id)),
    ).toHaveLength(1);
  });

  it("rejects text over 20000 characters", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("w-long@test.local");

    await expect(saveDraftText(user.id, attempt.id, "x".repeat(20_001))).rejects.toThrow(
      RangeError,
    );
  });

  it("refuses once the working is submitted", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("w-locked@test.local");
    await saveDraftText(user.id, attempt.id, "done");
    await submitWorking(user.id, attempt.id);

    await expect(saveDraftText(user.id, attempt.id, "changed")).rejects.toBeInstanceOf(
      SubmissionLockedError,
    );
    expect((await getWorkingFor(user.id, attempt.id)).text).toBe("done");
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("w-owner@test.local");
    const other = await setup("w-other@test.local");

    await expect(saveDraftText(other.user.id, owner.attempts[0].id, "x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("addDraftFiles", () => {
  it("adds files in order", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-order@test.local");

    await addDraftFiles(user.id, attempt.id, [jpg(1), jpg(2)]);
    await addDraftFiles(user.id, attempt.id, [jpg(3)]);

    const work = await getWorkingFor(user.id, attempt.id);
    expect(work.files.map((f) => f.path)).toEqual(["k/1.jpg", "k/2.jpg", "k/3.jpg"]);
    expect(work.files.map((f) => f.position)).toEqual([0, 1, 2]);
  });

  it("accepts one PDF", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-pdf@test.local");

    await addDraftFiles(user.id, attempt.id, [pdf()]);

    expect((await getWorkingFor(user.id, attempt.id)).files).toHaveLength(1);
  });

  it("rejects a PDF mixed with images, in one go or across two", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-mix@test.local");

    await expect(addDraftFiles(user.id, attempt.id, [pdf(), jpg()])).rejects.toBeInstanceOf(
      WorkingFilesError,
    );
    await addDraftFiles(user.id, attempt.id, [jpg()]);
    await expect(addDraftFiles(user.id, attempt.id, [pdf()])).rejects.toBeInstanceOf(
      WorkingFilesError,
    );
  });

  it("rejects a second PDF", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-pdf2@test.local");
    await addDraftFiles(user.id, attempt.id, [pdf(1)]);

    await expect(addDraftFiles(user.id, attempt.id, [pdf(2)])).rejects.toBeInstanceOf(
      WorkingFilesError,
    );
  });

  it("allows ten images in total but not eleven", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-ten@test.local");
    await addDraftFiles(
      user.id,
      attempt.id,
      Array.from({ length: 10 }, (_, i) => jpg(i)),
    );

    await expect(addDraftFiles(user.id, attempt.id, [jpg(99)])).rejects.toBeInstanceOf(
      WorkingFilesError,
    );
    expect((await getWorkingFor(user.id, attempt.id)).files).toHaveLength(10);
  });

  it("refuses once the working is submitted", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("f-locked@test.local");
    await addDraftFiles(user.id, attempt.id, [jpg()]);
    await submitWorking(user.id, attempt.id);

    await expect(addDraftFiles(user.id, attempt.id, [jpg(2)])).rejects.toBeInstanceOf(
      SubmissionLockedError,
    );
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("f-owner@test.local");
    const other = await setup("f-other@test.local");

    await expect(
      addDraftFiles(other.user.id, owner.attempts[0].id, [jpg()]),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("removeDraftFile", () => {
  it("removes a file from the draft and returns its storage path", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("r-ok@test.local");
    await addDraftFiles(user.id, attempt.id, [jpg(1), jpg(2)]);
    const [first] = (await getWorkingFor(user.id, attempt.id)).files;

    expect(await removeDraftFile(user.id, first.id)).toBe("k/1.jpg");

    expect((await getWorkingFor(user.id, attempt.id)).files.map((f) => f.path)).toEqual([
      "k/2.jpg",
    ]);
  });

  it("refuses once the working is submitted", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("r-locked@test.local");
    await addDraftFiles(user.id, attempt.id, [jpg()]);
    const [file] = (await getWorkingFor(user.id, attempt.id)).files;
    await submitWorking(user.id, attempt.id);

    await expect(removeDraftFile(user.id, file.id)).rejects.toBeInstanceOf(SubmissionLockedError);
    expect(
      await db.select().from(submissionFiles).where(eq(submissionFiles.id, file.id)),
    ).toHaveLength(1);
  });

  it("refuses another user's file", async () => {
    const owner = await setup("r-owner@test.local");
    const other = await setup("r-other@test.local");
    await addDraftFiles(owner.user.id, owner.attempts[0].id, [jpg()]);
    const [file] = (await getWorkingFor(owner.user.id, owner.attempts[0].id)).files;

    await expect(removeDraftFile(other.user.id, file.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("submitWorking", () => {
  it("refuses an attempt with no working", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("s-empty@test.local");

    await expect(submitWorking(user.id, attempt.id)).rejects.toBeInstanceOf(EmptyWorkingError);
  });

  it("refuses text that is only spaces", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("s-blank@test.local");
    await saveDraftText(user.id, attempt.id, "   \n ");

    await expect(submitWorking(user.id, attempt.id)).rejects.toBeInstanceOf(EmptyWorkingError);
  });

  it("submits typed working", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("s-text@test.local");
    await saveDraftText(user.id, attempt.id, "my answer");

    const result = await submitWorking(user.id, attempt.id);

    expect(result.alreadySubmitted).toBe(false);
    expect((await getWorkingFor(user.id, attempt.id)).submittedAt).toBeInstanceOf(Date);
  });

  it("submits working that is only files", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("s-files@test.local");
    await addDraftFiles(user.id, attempt.id, [jpg()]);

    expect((await submitWorking(user.id, attempt.id)).alreadySubmitted).toBe(false);
  });

  it("does not change an already submitted attempt", async () => {
    const {
      user,
      attempts: [attempt],
    } = await setup("s-twice@test.local");
    await saveDraftText(user.id, attempt.id, "answer");
    await submitWorking(user.id, attempt.id);
    const first = (await getWorkingFor(user.id, attempt.id)).submittedAt;

    const again = await submitWorking(user.id, attempt.id);

    expect(again.alreadySubmitted).toBe(true);
    expect((await getWorkingFor(user.id, attempt.id)).submittedAt).toEqual(first);
  });

  it("refuses another user's attempt", async () => {
    const owner = await setup("s-owner@test.local");
    const other = await setup("s-other@test.local");
    await saveDraftText(owner.user.id, owner.attempts[0].id, "x");

    await expect(submitWorking(other.user.id, owner.attempts[0].id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("submitAllDrafts", () => {
  it("submits every draft that has working and leaves the rest", async () => {
    const { user, sheet, attempts: made } = await setup("a-mix@test.local", 4);
    await saveDraftText(user.id, made[0].id, "answer one");
    await addDraftFiles(user.id, made[1].id, [jpg()]);
    // made[2] has no working at all; made[3] was submitted earlier.
    await saveDraftText(user.id, made[3].id, "earlier");
    await submitWorking(user.id, made[3].id);

    const submitted = await submitAllDrafts(user.id, sheet.id);

    expect(submitted.map((s) => s.attemptId).sort()).toEqual([made[0].id, made[1].id].sort());
    expect(submitted.every((s) => typeof s.submissionId === "string")).toBe(true);
    expect((await getWorkingFor(user.id, made[0].id)).submittedAt).not.toBeNull();
    expect((await getWorkingFor(user.id, made[1].id)).submittedAt).not.toBeNull();
    expect((await getWorkingFor(user.id, made[2].id)).submittedAt).toBeNull();
  });

  it("does not touch another user's drafts", async () => {
    const owner = await setup("a-owner@test.local");
    const other = await setup("a-other@test.local");
    await saveDraftText(owner.user.id, owner.attempts[0].id, "mine");

    expect(await submitAllDrafts(other.user.id, owner.sheet.id)).toEqual([]);
    expect((await getWorkingFor(owner.user.id, owner.attempts[0].id)).submittedAt).toBeNull();
  });
});
