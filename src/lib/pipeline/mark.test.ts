import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheets,
  solutions,
  submissionFiles,
  submissions,
  users,
} from "@/db/schema";
import { STALE_JOB_MS } from "@/lib/domain";

import { runMark, type MarkIo } from "./mark";

type MarkResult = Awaited<ReturnType<MarkIo["mark"]>>;

const result = (o: Partial<MarkResult> = {}): MarkResult => ({
  score: 3,
  mistakes: [
    { type: "algebra_slip", quote: "line 3", hint: "Check the sign.", location: { kind: "text" } },
    {
      type: "incomplete",
      quote: "line 5",
      hint: "Is that the whole answer?",
      location: { kind: "text" },
    },
  ],
  feedback: "Sign slip in line 3.",
  overallFeedback: "Good method.",
  ...o,
});

const okIo = (o: Partial<MarkResult> = {}): MarkIo => ({
  readFile: async () => Buffer.from("fake-image"),
  mark: async () => result(o),
});

async function setup(
  email: string,
  o: { submitted?: boolean; solution?: boolean; files?: number } = {},
) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "Prove P.",
      expectedMinutes: 5,
    })
    .returning();
  if (o.solution !== false) {
    await db.insert(solutions).values([
      { questionId: question.id, basis: "ai", body: "AI solution" },
      { questionId: question.id, basis: "official", body: "Official solution" },
    ]);
  }
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({
      attemptId: attempt.id,
      text: "My working",
      submittedAt: o.submitted === false ? null : new Date(),
    })
    .returning();
  for (let i = 0; i < (o.files ?? 0); i++) {
    await db
      .insert(submissionFiles)
      .values({ submissionId: submission.id, path: `k${i}.jpg`, mime: "image/jpeg", position: i });
  }
  return { user, attempt, submission, question };
}

const marksOf = (attemptId: string) =>
  db.select().from(marks).where(eq(marks.attemptId, attemptId)).orderBy(marks.createdAt);
const statusOf = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0].markStatus;

describe("runMark (ai)", () => {
  it("saves a mark with the outcome derived from the score and marks the submission done", async () => {
    const { attempt, submission } = await setup("m-ok@test.local");

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 3 }));

    const [mark] = await marksOf(attempt.id);
    expect(mark).toMatchObject({
      basis: "ai",
      score: 3,
      outcome: "partial",
      errorType: "algebra_slip",
      firstWrongStep: "line 3",
      mistakes: result().mistakes,
      feedback: "Sign slip in line 3.",
      overallFeedback: "Good method.",
      isDispute: false,
      outcomeChanged: false,
    });
    expect(await statusOf(submission.id)).toBe("done");
  });

  it.each([
    [5, "full"],
    [4, "full"],
    [3, "partial"],
    [2, "partial"],
    [1, "stuck"],
    [0, "stuck"],
  ] as const)("a score of %i is %s", async (score, outcome) => {
    const { attempt, submission } = await setup(`m-score-${score}@test.local`);

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score, mistakes: [] }));

    expect((await marksOf(attempt.id))[0].outcome).toBe(outcome);
  });

  it("a mark with no mistakes saves an empty list, not null, and no error type", async () => {
    const { attempt, submission } = await setup("m-empty@test.local");

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 5, mistakes: [] }));

    expect((await marksOf(attempt.id))[0]).toMatchObject({
      mistakes: [],
      errorType: null,
      firstWrongStep: null,
    });
  });

  it("a 4 is correct, so it keeps its careless slips in the list but has no error type", async () => {
    const { attempt, submission } = await setup("m-four@test.local");
    const slip = result().mistakes.slice(0, 1);

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 4, mistakes: slip }));

    expect((await marksOf(attempt.id))[0]).toMatchObject({
      outcome: "full",
      mistakes: slip,
      errorType: null,
    });
  });

  it("sends the question, the AI solution, the typed text and the photos to the marker", async () => {
    const { submission } = await setup("m-input@test.local", { files: 2 });
    const mark = vi.fn(async () => result());

    await runMark(
      { submissionId: submission.id, basis: "ai" },
      { readFile: async () => Buffer.from("img"), mark },
    );

    expect(mark).toHaveBeenCalledWith({
      questionBody: "Prove P.",
      solution: "AI solution",
      working: {
        text: "My working",
        files: [
          { mime: "image/jpeg", data: Buffer.from("img") },
          { mime: "image/jpeg", data: Buffer.from("img") },
        ],
      },
      disputeReason: undefined,
    });
  });

  it("does nothing when run again after it is done", async () => {
    const { attempt, submission } = await setup("m-twice@test.local");
    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());
    const mark = vi.fn(okIo().mark);

    await runMark({ submissionId: submission.id, basis: "ai" }, { ...okIo(), mark });

    expect(mark).not.toHaveBeenCalled();
    expect(await marksOf(attempt.id)).toHaveLength(1);
  });

  it("saves one mark when two runs overlap", async () => {
    const { attempt, submission } = await setup("m-race@test.local");

    await Promise.all([
      runMark({ submissionId: submission.id, basis: "ai" }, okIo()),
      runMark({ submissionId: submission.id, basis: "ai" }, okIo()),
    ]);

    expect(await marksOf(attempt.id)).toHaveLength(1);
  });

  it("does nothing for working that has not been submitted", async () => {
    const { attempt, submission } = await setup("m-draft@test.local", { submitted: false });

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());

    expect(await marksOf(attempt.id)).toHaveLength(0);
    expect(await statusOf(submission.id)).toBe("none");
  });

  it("marks the submission failed and saves nothing when the marker throws", async () => {
    const { attempt, submission } = await setup("m-fail@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMark(
      { submissionId: submission.id, basis: "ai" },
      {
        ...okIo(),
        mark: async () => {
          throw new Error("api down");
        },
      },
    );

    expect(await statusOf(submission.id)).toBe("failed");
    expect(await marksOf(attempt.id)).toHaveLength(0);
  });

  it("marks the submission failed when a photo cannot be read from storage", async () => {
    const { submission } = await setup("m-read@test.local", { files: 1 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMark(
      { submissionId: submission.id, basis: "ai" },
      {
        ...okIo(),
        readFile: async () => {
          throw new Error("storage down");
        },
      },
    );

    expect(await statusOf(submission.id)).toBe("failed");
  });

  it("marks the submission failed when the question has no solution yet", async () => {
    const { attempt, submission } = await setup("m-nosol@test.local", { solution: false });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());

    expect(await statusOf(submission.id)).toBe("failed");
    expect(await marksOf(attempt.id)).toHaveLength(0);
  });

  it("can be run again after a failure", async () => {
    const { attempt, submission } = await setup("m-retry@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runMark(
      { submissionId: submission.id, basis: "ai" },
      {
        ...okIo(),
        mark: async () => {
          throw new Error("x");
        },
      },
    );

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());

    expect(await marksOf(attempt.id)).toHaveLength(1);
    expect(await statusOf(submission.id)).toBe("done");
  });

  it("takes over a mark that has been pending for too long", async () => {
    const { attempt, submission } = await setup("m-stale@test.local");
    await db
      .update(submissions)
      .set({
        markStatus: "pending",
        markStatusUpdatedAt: new Date(Date.now() - STALE_JOB_MS - 1000),
      })
      .where(eq(submissions.id, submission.id));

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());

    expect(await marksOf(attempt.id)).toHaveLength(1);
  });

  it("leaves a mark that is still being worked on", async () => {
    const { attempt, submission } = await setup("m-busy@test.local");
    await db
      .update(submissions)
      .set({ markStatus: "pending", markStatusUpdatedAt: new Date() })
      .where(eq(submissions.id, submission.id));

    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());

    expect(await marksOf(attempt.id)).toHaveLength(0);
  });
});

describe("runMark (dispute and official)", () => {
  it("a dispute adds a new mark flagged as a dispute and keeps the earlier one", async () => {
    const { attempt, submission } = await setup("d-ok@test.local");
    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 2 }));

    await runMark(
      { submissionId: submission.id, basis: "ai", disputeReason: "I used a different method" },
      okIo({ score: 5, mistakes: [] }),
    );

    const all = await marksOf(attempt.id);
    expect(all.map((m) => [m.score, m.isDispute, m.disputeReason])).toEqual([
      [2, false, null],
      [5, true, "I used a different method"],
    ]);
    expect(await statusOf(submission.id)).toBe("done");
  });

  it("passes the dispute reason to the marker", async () => {
    const { submission } = await setup("d-reason@test.local");
    await runMark({ submissionId: submission.id, basis: "ai" }, okIo());
    const mark = vi.fn(async () => result());

    await runMark(
      { submissionId: submission.id, basis: "ai", disputeReason: "check line 2" },
      { ...okIo(), mark },
    );

    expect(mark).toHaveBeenCalledWith(expect.objectContaining({ disputeReason: "check line 2" }));
  });

  it("an official mark uses the official solution and flags a changed outcome", async () => {
    const { attempt, submission } = await setup("o-changed@test.local");
    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 5, mistakes: [] }));
    const mark = vi.fn(async () => result({ score: 2 }));

    await runMark({ submissionId: submission.id, basis: "official" }, { ...okIo(), mark });

    expect(mark).toHaveBeenCalledWith(expect.objectContaining({ solution: "Official solution" }));
    const all = await marksOf(attempt.id);
    expect(all.map((m) => [m.basis, m.outcome, m.outcomeChanged])).toEqual([
      ["ai", "full", false],
      ["official", "partial", true],
    ]);
  });

  it("an official mark with the same outcome is not flagged as changed", async () => {
    const { attempt, submission } = await setup("o-same@test.local");
    await runMark({ submissionId: submission.id, basis: "ai" }, okIo({ score: 3 }));

    await runMark({ submissionId: submission.id, basis: "official" }, okIo({ score: 2 }));

    expect((await marksOf(attempt.id))[1].outcomeChanged).toBe(false);
  });
});
