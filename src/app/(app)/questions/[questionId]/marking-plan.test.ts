// The "Mark with AI now" switch on the two submit paths of a sheet's questions: one question
// (submitWorkingAction) and "Submit all drafts" (submitAllAction). The batch upload is tested
// in sheets/[sheetId]/batch/actions.test.ts. The fake AI client counts every marking call.

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheets,
  solutions,
  submissions,
  users,
} from "@/db/schema";
import { DEMO_AI_LIMIT_MESSAGE } from "@/lib/ai/budget";
import { setAiClient } from "@/lib/ai/client";
import { fakeAi, fixture, makeDemoCopy, sentText } from "@/lib/ai/test-helpers";

const signedIn = vi.hoisted(() => ({ id: "" }));
const after = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitAllAction } from "../../sheets/[sheetId]/actions";
import { submitWorkingAction } from "./submit-actions";

async function world(email: string, o: { official?: boolean; questions?: number } = {}) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const qs = await db
    .insert(questions)
    .values(
      Array.from({ length: o.questions ?? 1 }, (_, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label: `${i + 1}`,
        body: "Prove P.",
        expectedMinutes: 5,
      })),
    )
    .returning();
  for (const q of qs) {
    await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "AI solution" });
    if (o.official)
      await db.insert(solutions).values({ questionId: q.id, basis: "official", body: "Official" });
  }
  signedIn.id = user.id;
  const draft = async (questionId: string) => {
    const [attempt] = await db
      .insert(attempts)
      .values({ userId: user.id, questionId, context: "sheet" })
      .returning();
    const [submission] = await db
      .insert(submissions)
      .values({ attemptId: attempt.id, text: "My working" })
      .returning();
    return { attempt, submission };
  };
  return { user, sheet, qs, draft };
}

const submissionRow = async (id: string) =>
  (await db.select().from(submissions).where(eq(submissions.id, id)))[0];
const marksOf = (attemptId: string) =>
  db.select().from(marks).where(eq(marks.attemptId, attemptId));
const sheetRow = async (id: string) => (await db.select().from(sheets).where(eq(sheets.id, id)))[0];

/** Runs the background jobs that after() was given, as the server would. */
async function runBackground() {
  await Promise.all(after.mock.calls.map(([job]) => job()));
}

let create: ReturnType<typeof fakeAi>;

/** The marking requests the fake AI got (the common-errors refresh makes calls of its own). */
const markRequests = () =>
  create.mock.calls
    .map(([params], index) => ({ system: String(params.system), index }))
    .filter(({ system }) => system.includes("fair marker of university mathematics"))
    .map(({ index }) => sentText(create, index));

beforeEach(() => {
  after.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  create = fakeAi(...Array.from({ length: 5 }, () => fixture("markAttempt")));
});

afterEach(() => {
  setAiClient(null);
  vi.restoreAllMocks();
});

describe("submitWorkingAction and the marking plan", () => {
  it("marks with the AI by default, against the AI-written solution", async () => {
    const w = await world("mp-q-ai@test.local");
    const { attempt, submission } = await w.draft(w.qs[0].id);

    expect(await submitWorkingAction({ attemptId: attempt.id })).toEqual({ ok: true });
    expect((await submissionRow(submission.id)).markStatus).toBe("pending");
    await runBackground();

    expect(markRequests()).toHaveLength(1);
    expect(markRequests()[0]).toContain("AI solution");
    expect((await submissionRow(submission.id)).markStatus).toBe("done");
    expect((await marksOf(attempt.id)).map((m) => m.basis)).toEqual(["ai"]);
  });

  it("with the switch off makes no AI call and waits for the official solutions", async () => {
    const w = await world("mp-q-wait@test.local");
    const { attempt, submission } = await w.draft(w.qs[0].id);

    expect(await submitWorkingAction({ attemptId: attempt.id, markWithAi: false })).toEqual({
      ok: true,
    });
    await runBackground();

    expect(after).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    const row = await submissionRow(submission.id);
    expect(row.submittedAt).not.toBeNull();
    expect(row.markStatus).toBe("awaiting_official");
    expect(await marksOf(attempt.id)).toEqual([]);
  });

  it("saves the switch on the sheet and starts from it next time", async () => {
    const w = await world("mp-q-remember@test.local", { questions: 2 });
    const first = await w.draft(w.qs[0].id);
    const second = await w.draft(w.qs[1].id);

    await submitWorkingAction({ attemptId: first.attempt.id, markWithAi: false });
    expect((await sheetRow(w.sheet.id)).markWithAi).toBe(false);

    // The next submit sends nothing: the sheet's position (off) is used.
    await submitWorkingAction({ attemptId: second.attempt.id });
    expect((await submissionRow(second.submission.id)).markStatus).toBe("awaiting_official");
    expect(create).not.toHaveBeenCalled();

    // Turning it on again is saved too.
    const third = await w.draft(w.qs[0].id);
    await submitWorkingAction({ attemptId: third.attempt.id, markWithAi: true });
    expect((await sheetRow(w.sheet.id)).markWithAi).toBe(true);
  });

  it.each([true, false])(
    "marks once against the official solution when there is one, with the switch %s",
    async (markWithAi) => {
      const w = await world(`mp-q-official-${markWithAi}@test.local`, { official: true });
      const { attempt, submission } = await w.draft(w.qs[0].id);

      expect(await submitWorkingAction({ attemptId: attempt.id, markWithAi })).toEqual({
        ok: true,
      });
      await runBackground();

      // The AI was given the official solution only, and only an official mark was saved.
      expect(markRequests()).toHaveLength(1);
      expect(markRequests()[0]).toContain("Official");
      expect(markRequests()[0]).not.toContain("AI solution");
      expect((await marksOf(attempt.id)).map((m) => m.basis)).toEqual(["official"]);
      expect((await submissionRow(submission.id)).markStatus).toBe("done");
    },
  );

  it("does not trust the form: the plan comes from the database", async () => {
    const w = await world("mp-q-trust@test.local", { official: true });
    const { attempt } = await w.draft(w.qs[0].id);
    // A forged field cannot ask for an AI-basis mark.
    await submitWorkingAction({ attemptId: attempt.id, markWithAi: true, basis: "ai" } as never);
    await runBackground();
    expect((await marksOf(attempt.id)).map((m) => m.basis)).toEqual(["official"]);
  });

  it("lets a demo copy at its AI limit submit with the switch off, but not with it on", async () => {
    const w = await world("mp-q-demo@test.local");
    await makeDemoCopy(w.user.id, 30);
    const { attempt, submission } = await w.draft(w.qs[0].id);

    expect(await submitWorkingAction({ attemptId: attempt.id })).toEqual({
      ok: false,
      error: DEMO_AI_LIMIT_MESSAGE,
    });
    expect((await submissionRow(submission.id)).submittedAt).toBeNull();

    expect(await submitWorkingAction({ attemptId: attempt.id, markWithAi: false })).toEqual({
      ok: true,
    });
    expect((await submissionRow(submission.id)).markStatus).toBe("awaiting_official");
  });

  it("still refuses a demo copy at its limit when the official solution would be marked", async () => {
    const w = await world("mp-q-demo-off@test.local", { official: true });
    await makeDemoCopy(w.user.id, 30);
    const { attempt } = await w.draft(w.qs[0].id);

    expect(await submitWorkingAction({ attemptId: attempt.id, markWithAi: false })).toEqual({
      ok: false,
      error: DEMO_AI_LIMIT_MESSAGE,
    });
  });

  it("submitting twice marks once", async () => {
    const w = await world("mp-q-twice@test.local");
    const { attempt } = await w.draft(w.qs[0].id);
    await submitWorkingAction({ attemptId: attempt.id });
    await submitWorkingAction({ attemptId: attempt.id });
    await runBackground();
    expect(markRequests()).toHaveLength(1);
  });
});

describe("submitAllAction and the marking plan", () => {
  const form = (markWithAi?: string) => {
    const data = new FormData();
    if (markWithAi !== undefined) data.set("markWithAi", markWithAi);
    return data;
  };

  it("marks every draft with the AI by default", async () => {
    const w = await world("mp-all-ai@test.local", { questions: 2 });
    const drafts = [await w.draft(w.qs[0].id), await w.draft(w.qs[1].id)];

    await submitAllAction(w.sheet.id, form());
    await runBackground();

    expect(markRequests()).toHaveLength(2);
    for (const { attempt } of drafts)
      expect((await marksOf(attempt.id)).map((m) => m.basis)).toEqual(["ai"]);
  });

  it("with the switch off makes no AI call and every draft waits", async () => {
    const w = await world("mp-all-wait@test.local", { questions: 2 });
    const drafts = [await w.draft(w.qs[0].id), await w.draft(w.qs[1].id)];

    await submitAllAction(w.sheet.id, form("false"));
    await runBackground();

    expect(create).not.toHaveBeenCalled();
    for (const { submission } of drafts)
      expect((await submissionRow(submission.id)).markStatus).toBe("awaiting_official");
    expect((await sheetRow(w.sheet.id)).markWithAi).toBe(false);
  });

  it("uses the sheet's saved position when the form sends none", async () => {
    const w = await world("mp-all-saved@test.local");
    await db.update(sheets).set({ markWithAi: false }).where(eq(sheets.id, w.sheet.id));
    const { submission } = await w.draft(w.qs[0].id);

    await submitAllAction(w.sheet.id);

    expect((await submissionRow(submission.id)).markStatus).toBe("awaiting_official");
    expect(create).not.toHaveBeenCalled();
  });

  it("marks against the official solution where there is one and waits elsewhere", async () => {
    const w = await world("mp-all-mixed@test.local", { questions: 2 });
    await db
      .insert(solutions)
      .values({ questionId: w.qs[0].id, basis: "official", body: "Official" });
    const drafts = [await w.draft(w.qs[0].id), await w.draft(w.qs[1].id)];

    await submitAllAction(w.sheet.id, form("off"));
    await runBackground();

    expect(markRequests()).toHaveLength(1);
    expect((await marksOf(drafts[0].attempt.id)).map((m) => m.basis)).toEqual(["official"]);
    expect((await submissionRow(drafts[1].submission.id)).markStatus).toBe("awaiting_official");
  });

  it("starts nothing for a demo copy at its limit with the switch on, and gives another user's sheet the 404 page", async () => {
    const w = await world("mp-all-demo@test.local");
    await makeDemoCopy(w.user.id, 30);
    const { submission } = await w.draft(w.qs[0].id);

    await submitAllAction(w.sheet.id, form("true"));
    expect((await submissionRow(submission.id)).submittedAt).toBeNull();

    const other = await world("mp-all-other@test.local");
    signedIn.id = other.user.id;
    await expect(submitAllAction(w.sheet.id, form())).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
  });
});
