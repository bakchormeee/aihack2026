import { asc, eq } from "drizzle-orm";
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
  BatchWorkingError,
  openBatchAttempts,
  submitBatchWorking,
  unusedWorkingKeys,
} from "./batch-working";

async function setup(email: string, count = 3) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const qs = await db
    .insert(questions)
    .values(
      Array.from({ length: count }, (_, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: String(i + 1),
        body: "Q",
        expectedMinutes: 5,
      })),
    )
    .returning();
  return { user, course, sheet, qs };
}

const crop = (userId: string, attemptId: string, n: number) => ({
  key: `u/${userId}/working/${attemptId}/c${n}.jpg`,
  mime: "image/jpeg",
});

async function filesOf(attemptId: string) {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.attemptId, attemptId));
  if (!submission) return { submission: null, files: [] };
  const files = await db
    .select()
    .from(submissionFiles)
    .where(eq(submissionFiles.submissionId, submission.id))
    .orderBy(asc(submissionFiles.position));
  return { submission, files };
}

describe("openBatchAttempts", () => {
  it("returns the open attempt, or a new one with no hints and no time", async () => {
    const { user, sheet, qs } = await setup("bw-open@test.local");
    const [open] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: qs[0].id, context: "sheet", secondsSpent: 120 })
      .returning();

    const opened = await openBatchAttempts(user.id, sheet.id, [qs[0].id, qs[1].id]);

    expect(opened[0]).toEqual({ questionId: qs[0].id, attemptId: open.id });
    const [created] = await db.select().from(attempts).where(eq(attempts.id, opened[1].attemptId));
    expect(created).toMatchObject({
      questionId: qs[1].id,
      inheritedHintLevel: 0,
      secondsSpent: null,
      revisionSessionId: null,
    });
    // Calling it again gives the same attempts.
    expect(await openBatchAttempts(user.id, sheet.id, [qs[0].id, qs[1].id])).toEqual(opened);
  });

  it("refuses a question of another sheet, a submitted one, a repeat, or none", async () => {
    const { user, sheet, qs } = await setup("bw-open-refuse@test.local");
    const other = await setup("bw-open-other@test.local");
    const [done] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId: qs[2].id, context: "sheet" })
      .returning();
    await db.insert(submissions).values({ attemptId: done.id, text: "x", submittedAt: new Date() });

    const refuse = (ids: string[]) => openBatchAttempts(user.id, sheet.id, ids);
    await expect(refuse([other.qs[0].id])).rejects.toThrow(
      "A region was given to a question that cannot take working.",
    );
    await expect(refuse([qs[2].id])).rejects.toBeInstanceOf(BatchWorkingError);
    await expect(refuse([qs[0].id, qs[0].id])).rejects.toThrow("A question was given twice.");
    await expect(refuse([])).rejects.toThrow("Give at least one region to a question.");
    await expect(
      openBatchAttempts(user.id, other.sheet.id, [other.qs[0].id]),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(attempts).where(eq(attempts.userId, user.id))).toHaveLength(1);
  });

  it("refuses a sheet that is not ready", async () => {
    const { user, sheet, qs } = await setup("bw-open-parsing@test.local");
    await db.update(sheets).set({ status: "parsing" }).where(eq(sheets.id, sheet.id));
    await expect(openBatchAttempts(user.id, sheet.id, [qs[0].id])).rejects.toThrow(
      "This sheet is not ready yet.",
    );
  });
});

describe("submitBatchWorking", () => {
  it("adds the crops in order after the draft's text and files, and submits each question", async () => {
    const { user, sheet, qs } = await setup("bw-submit@test.local");
    const [a, b] = await openBatchAttempts(user.id, sheet.id, [qs[0].id, qs[1].id]);
    const [draft] = await db
      .insert(submissions)
      .values({ attemptId: a.attemptId, text: "Typed first" })
      .returning();
    await db
      .insert(submissionFiles)
      .values({
        submissionId: draft.id,
        path: "u/x/working/old.jpg",
        mime: "image/jpeg",
        position: 0,
      });

    const result = await submitBatchWorking(user.id, sheet.id, [
      {
        questionId: qs[0].id,
        crops: [crop(user.id, a.attemptId, 1), crop(user.id, a.attemptId, 2)],
      },
      { questionId: qs[1].id, crops: [crop(user.id, b.attemptId, 3)] },
    ]);

    expect(result.map((r) => r.attemptId)).toEqual([a.attemptId, b.attemptId]);
    const first = await filesOf(a.attemptId);
    expect(first.submission?.text).toBe("Typed first");
    expect(first.submission?.submittedAt).not.toBeNull();
    expect(first.submission?.id).toBe(result[0].submissionId);
    expect(first.files.map((f) => [f.path, f.position])).toEqual([
      ["u/x/working/old.jpg", 0],
      [crop(user.id, a.attemptId, 1).key, 1],
      [crop(user.id, a.attemptId, 2).key, 2],
    ]);
    const second = await filesOf(b.attemptId);
    expect(second.files.map((f) => f.path)).toEqual([crop(user.id, b.attemptId, 3).key]);
    expect(second.submission?.submittedAt).not.toBeNull();
    // The question that was not confirmed is untouched.
    expect(await db.select().from(attempts).where(eq(attempts.questionId, qs[2].id))).toEqual([]);
  });

  it("saves nothing when one question is wrong", async () => {
    const { user, sheet, qs } = await setup("bw-atomic@test.local");
    const other = await setup("bw-atomic-other@test.local");
    const [a, b] = await openBatchAttempts(user.id, sheet.id, [qs[0].id, qs[1].id]);
    const good = { questionId: qs[0].id, crops: [crop(user.id, a.attemptId, 1)] };

    const cases: [unknown[], string][] = [
      // A crop uploaded for another question's attempt.
      [
        [good, { questionId: qs[1].id, crops: [crop(user.id, a.attemptId, 2)] }],
        "A crop was not uploaded for its question.",
      ],
      // Another user's key.
      [
        [good, { questionId: qs[1].id, crops: [crop(other.user.id, b.attemptId, 2)] }],
        "A crop was not uploaded for its question.",
      ],
      // A question of another sheet.
      [
        [good, { questionId: other.qs[0].id, crops: [crop(user.id, b.attemptId, 2)] }],
        "A region was given to a question that cannot take working.",
      ],
      [[good, { questionId: qs[1].id, crops: [] }], "Each question needs at least one region."],
      [
        [
          good,
          {
            questionId: qs[1].id,
            crops: [{ ...crop(user.id, b.attemptId, 2), mime: "application/pdf" }],
          },
        ],
        "Each crop must be a JPEG, PNG or WebP image.",
      ],
      [
        [
          good,
          {
            questionId: qs[1].id,
            crops: Array.from({ length: 11 }, (_, i) => crop(user.id, b.attemptId, 10 + i)),
          },
        ],
        "A question can have at most 10 regions.",
      ],
      [
        [good, { questionId: qs[1].id, crops: [crop(user.id, a.attemptId, 1)] }],
        "A crop was sent twice.",
      ],
      [[], "Give at least one region to a question."],
    ];
    for (const [confirmed, message] of cases) {
      await expect(
        submitBatchWorking(
          user.id,
          sheet.id,
          confirmed as Parameters<typeof submitBatchWorking>[2],
        ),
      ).rejects.toThrow(message);
    }

    expect((await filesOf(a.attemptId)).submission).toBeNull();
    expect((await filesOf(b.attemptId)).submission).toBeNull();
  });

  it("refuses a question without an open attempt (crops cannot have been uploaded for it)", async () => {
    const { user, sheet, qs } = await setup("bw-no-attempt@test.local");
    await expect(
      submitBatchWorking(user.id, sheet.id, [
        { questionId: qs[0].id, crops: [crop(user.id, "none", 1)] },
      ]),
    ).rejects.toThrow("A region was given to a question that cannot take working.");
  });

  it("refuses more than 10 images in all, and a draft with a PDF, keeping the draft as it was", async () => {
    const { user, sheet, qs } = await setup("bw-limit@test.local");
    const [a, b] = await openBatchAttempts(user.id, sheet.id, [qs[0].id, qs[1].id]);
    const [draftA] = await db.insert(submissions).values({ attemptId: a.attemptId }).returning();
    await db.insert(submissionFiles).values(
      Array.from({ length: 9 }, (_, i) => ({
        submissionId: draftA.id,
        path: `u/x/working/old${i}.jpg`,
        mime: "image/jpeg",
        position: i,
      })),
    );
    const [draftB] = await db.insert(submissions).values({ attemptId: b.attemptId }).returning();
    await db
      .insert(submissionFiles)
      .values({
        submissionId: draftB.id,
        path: "u/x/working/w.pdf",
        mime: "application/pdf",
        position: 0,
      });

    await expect(
      submitBatchWorking(user.id, sheet.id, [
        {
          questionId: qs[0].id,
          crops: [crop(user.id, a.attemptId, 1), crop(user.id, a.attemptId, 2)],
        },
      ]),
    ).rejects.toThrow("Question 1 cannot take these crops: Use at most 10 images.");
    await expect(
      submitBatchWorking(user.id, sheet.id, [
        { questionId: qs[1].id, crops: [crop(user.id, b.attemptId, 1)] },
      ]),
    ).rejects.toThrow(
      "Question 2 cannot take these crops: Use one PDF, or several images, not both.",
    );

    const after = await filesOf(a.attemptId);
    expect(after.files).toHaveLength(9);
    expect(after.submission?.submittedAt).toBeNull();
  });

  it("never changes submitted working, and refuses a key a submission already uses", async () => {
    const { user, sheet, qs } = await setup("bw-locked@test.local");
    const [a] = await openBatchAttempts(user.id, sheet.id, [qs[0].id]);
    const first = crop(user.id, a.attemptId, 1);
    await submitBatchWorking(user.id, sheet.id, [{ questionId: qs[0].id, crops: [first] }]);

    await expect(
      submitBatchWorking(user.id, sheet.id, [
        { questionId: qs[0].id, crops: [crop(user.id, a.attemptId, 2)] },
      ]),
    ).rejects.toThrow("A region was given to a question that cannot take working.");

    const [b] = await openBatchAttempts(user.id, sheet.id, [qs[1].id]);
    // A key that is already in a submission (here under the wrong attempt too).
    await expect(
      submitBatchWorking(user.id, sheet.id, [{ questionId: qs[1].id, crops: [first] }]),
    ).rejects.toThrow("A crop was not uploaded for its question.");
    expect((await filesOf(b.attemptId)).submission).toBeNull();
    expect((await filesOf(a.attemptId)).files).toHaveLength(1);
  });
});

describe("unusedWorkingKeys", () => {
  it("keeps only the user's own working keys that no submission uses", async () => {
    const { user, sheet, qs } = await setup("bw-unused@test.local");
    const [a] = await openBatchAttempts(user.id, sheet.id, [qs[0].id]);
    const used = crop(user.id, a.attemptId, 1).key;
    await submitBatchWorking(user.id, sheet.id, [
      { questionId: qs[0].id, crops: [{ key: used, mime: "image/jpeg" }] },
    ]);
    const unused = crop(user.id, a.attemptId, 2).key;

    expect(
      await unusedWorkingKeys(user.id, [
        used,
        unused,
        `u/someone-else/working/${a.attemptId}/x.jpg`,
        `u/${user.id}/batch/${sheet.id}/p.jpg`,
        `u/${user.id}/working/../batch/p.jpg`,
      ]),
    ).toEqual([unused]);
    expect(await unusedWorkingKeys(user.id, [])).toEqual([]);
  });
});
