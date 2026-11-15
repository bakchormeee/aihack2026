import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { attempts, courses, questions, sheets, submissions, users } from "@/db/schema";
import { DEMO_AI_LIMIT_MESSAGE } from "@/lib/ai/budget";
import { setAiClient, type AiClient } from "@/lib/ai/client";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";

const signedIn = vi.hoisted(() => ({ id: "" }));
const after = vi.hoisted(() => vi.fn());
// A fake object store: key -> type and size.
const stored = vi.hoisted(() => new Map<string, { mime: string; size: number }>());
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/storage/s3", () => ({
  statObject: async (key: string) => stored.get(key) ?? null,
  getObjectBytes: async (key: string) => Buffer.from(key),
  deleteObject: async (key: string) => void stored.delete(key),
  listObjects: async (prefix: string) => [...stored.keys()].filter((k) => k.startsWith(prefix)),
}));

import {
  cancelBatchAction,
  openBatchAttemptsAction,
  proposeBatchAction,
  submitBatchAction,
} from "./actions";

const MATCH_FAILED = "The photos could not be read. Try again, or attach working on each question.";

async function setup(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const qs = await db
    .insert(questions)
    .values(
      ["1", "2(a)", "2(b)", "3"].map((label, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label,
        body: `Body ${label}`,
        expectedMinutes: 5,
      })),
    )
    .returning();
  signedIn.id = user.id;
  const photo = (n: number, mime = "image/jpeg") => {
    const key = `u/${user.id}/batch/${sheet.id}/p${n}.jpg`;
    stored.set(key, { mime, size: 1000 });
    return key;
  };
  return { user, sheet, qs, photo };
}

beforeEach(() => {
  vi.stubEnv("AI_FIXTURES", "1");
  after.mockClear();
});

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("proposeBatchAction", () => {
  it("returns the matched regions by question id, the unmatched ones and the skipped questions", async () => {
    const { sheet, qs, photo } = await setup("ba-propose@test.local");

    const result = await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1), photo(2)] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.matched.map((m) => m.questionId)).toEqual(qs.map((q) => q.id));
    expect(result.proposal.unmatched).toHaveLength(1);
    expect(result.proposal.skipped).toEqual([]);
  });

  it("gives another user's sheet the 404 page", async () => {
    const { sheet } = await setup("ba-owner@test.local");
    const other = await setup("ba-intruder@test.local");

    await expect(
      proposeBatchAction({ sheetId: sheet.id, photoKeys: [other.photo(1)] }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("refuses photos that were not uploaded for this sheet, more than 10, or the same one twice", async () => {
    const { user, sheet, photo } = await setup("ba-keys@test.local");
    const elsewhere = `u/${user.id}/batch/another-sheet/p.jpg`;
    stored.set(elsewhere, { mime: "image/jpeg", size: 10 });

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [elsewhere] })).toEqual({
      ok: false,
      error: "Those photos were not uploaded for this sheet.",
    });
    const working = `u/${user.id}/working/${sheet.id}/p.jpg`;
    expect((await proposeBatchAction({ sheetId: sheet.id, photoKeys: [working] })).ok).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => photo(i));
    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: eleven })).toEqual({
      ok: false,
      error: "Choose between 1 and 10 photos.",
    });
    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [] })).toEqual({
      ok: false,
      error: "Choose between 1 and 10 photos.",
    });
    expect(
      await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1), photo(1)] }),
    ).toEqual({ ok: false, error: "The same photo was sent twice." });
  });

  it("refuses a photo that did not finish uploading, or that is a PDF", async () => {
    const { user, sheet, photo } = await setup("ba-verify@test.local");
    const missing = `u/${user.id}/batch/${sheet.id}/missing.jpg`;

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [missing] })).toEqual({
      ok: false,
      error: "The upload did not finish. Please try again.",
    });
    expect(
      await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1, "application/pdf")] }),
    ).toEqual({ ok: false, error: "Use JPEG, PNG or WebP photos." });
  });

  it("shows the spec's message when the AI fails, and keeps the photos", async () => {
    vi.stubEnv("AI_FIXTURES", "");
    const create = vi.fn(async () => {
      throw new Error("API down");
    });
    setAiClient({ messages: { create } } as unknown as AiClient);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sheet, photo } = await setup("ba-fail@test.local");
    const key = photo(1);

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [key] })).toEqual({
      ok: false,
      error: MATCH_FAILED,
    });
    expect(stored.has(key)).toBe(true);
  });

  it("passes on a reason the student can act on", async () => {
    const { sheet, photo } = await setup("ba-notready@test.local");
    await db.update(sheets).set({ status: "parsing" }).where(eq(sheets.id, sheet.id));

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1)] })).toEqual({
      ok: false,
      error: "This sheet is not ready yet.",
    });
  });

  it("refuses a demo copy that cannot pay for the matching and one mark, before the call", async () => {
    const { user, sheet, photo } = await setup("ba-demo@test.local");
    await makeDemoCopy(user.id, 29);

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1)] })).toEqual({
      ok: false,
      error: DEMO_AI_LIMIT_MESSAGE,
    });
    expect(await demoCallsOf(user.id)).toBe(29);

    await makeDemoCopy(user.id, 28);
    expect((await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1)] })).ok).toBe(true);
    expect(await demoCallsOf(user.id)).toBe(29);
  });

  it("turns the limit being reached during the call into the demo message", async () => {
    vi.stubEnv("AI_FIXTURES", "");
    const { user, sheet, photo } = await setup("ba-demo-race@test.local");
    await makeDemoCopy(user.id, 28);
    // Other work uses the last calls while this one runs; its reply is invalid, so the
    // retry finds the limit reached.
    const create = vi.fn(async () => {
      await makeDemoCopy(user.id, 30);
      return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] };
    });
    setAiClient({ messages: { create } } as unknown as AiClient);

    expect(await proposeBatchAction({ sheetId: sheet.id, photoKeys: [photo(1)] })).toEqual({
      ok: false,
      error: DEMO_AI_LIMIT_MESSAGE,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("openBatchAttemptsAction", () => {
  it("opens an attempt for each confirmed question and nothing else", async () => {
    const { user, sheet, qs } = await setup("ba-attempts@test.local");

    const result = await openBatchAttemptsAction({
      sheetId: sheet.id,
      questionIds: [qs[0].id, qs[2].id],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts.map((a) => a.questionId)).toEqual([qs[0].id, qs[2].id]);
    expect(await db.select().from(attempts).where(eq(attempts.userId, user.id))).toHaveLength(2);
  });

  it("refuses a question of another sheet, an empty list, a demo copy without calls, and gives a 404 for another user's sheet", async () => {
    const other = await setup("ba-attempts-other@test.local");
    const { user, sheet, qs } = await setup("ba-attempts-refuse@test.local");

    expect(
      await openBatchAttemptsAction({ sheetId: sheet.id, questionIds: [other.qs[0].id] }),
    ).toEqual({ ok: false, error: "A region was given to a question that cannot take working." });
    expect(await openBatchAttemptsAction({ sheetId: sheet.id, questionIds: [] })).toEqual({
      ok: false,
      error: "Give at least one region to a question.",
    });
    await expect(
      openBatchAttemptsAction({ sheetId: other.sheet.id, questionIds: [other.qs[0].id] }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    await makeDemoCopy(user.id, 29);
    expect(
      await openBatchAttemptsAction({ sheetId: sheet.id, questionIds: [qs[0].id, qs[1].id] }),
    ).toEqual({ ok: false, error: DEMO_AI_LIMIT_MESSAGE });
    expect(await db.select().from(attempts).where(eq(attempts.userId, user.id))).toEqual([]);
  });
});

describe("submitBatchAction", () => {
  async function ready(email: string) {
    const s = await setup(email);
    const opened = await openBatchAttemptsAction({
      sheetId: s.sheet.id,
      questionIds: [s.qs[0].id, s.qs[1].id],
    });
    if (!opened.ok) throw new Error(opened.error);
    const cropKey = (index: number, n: number) => {
      const key = `u/${s.user.id}/working/${opened.attempts[index].attemptId}/c${n}.jpg`;
      stored.set(key, { mime: "image/jpeg", size: 500 });
      return key;
    };
    return { ...s, attempts: opened.attempts, cropKey };
  }

  it("submits each question with its crops, claims the marks, marks in the background and deletes the photos", async () => {
    const { sheet, qs, attempts: opened, cropKey, photo } = await ready("ba-submit@test.local");
    const photos = [photo(1), photo(2)];

    const result = await submitBatchAction({
      sheetId: sheet.id,
      questions: [
        { questionId: qs[0].id, cropKeys: [cropKey(0, 1), cropKey(0, 2)] },
        { questionId: qs[1].id, cropKeys: [cropKey(1, 3)] },
      ],
    });

    expect(result).toEqual({ ok: true });
    for (const { attemptId } of opened) {
      const [submission] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.attemptId, attemptId));
      expect(submission.submittedAt).not.toBeNull();
      expect(submission.markStatus).toBe("pending");
    }
    expect(after).toHaveBeenCalledTimes(1);
    for (const key of photos) expect(stored.has(key)).toBe(false);
  });

  it("saves nothing and deletes the unused crops when a key is wrong", async () => {
    const { sheet, qs, attempts: opened, cropKey, photo } = await ready("ba-submit-bad@test.local");
    const kept = photo(1);
    const good = cropKey(0, 1);
    const wrongFolder = cropKey(0, 2); // uploaded for question 1's attempt, given to question 2

    const result = await submitBatchAction({
      sheetId: sheet.id,
      questions: [
        { questionId: qs[0].id, cropKeys: [good] },
        { questionId: qs[1].id, cropKeys: [wrongFolder] },
      ],
    });

    expect(result).toEqual({ ok: false, error: "A crop was not uploaded for its question." });
    expect(
      await db.select().from(submissions).where(eq(submissions.attemptId, opened[0].attemptId)),
    ).toEqual([]);
    expect(stored.has(good)).toBe(false);
    expect(stored.has(wrongFolder)).toBe(false);
    expect(stored.has(kept)).toBe(true);
    expect(after).not.toHaveBeenCalled();

    // Another user's key is refused and never deleted.
    const foreign = `u/someone-else/working/${opened[0].attemptId}/x.jpg`;
    stored.set(foreign, { mime: "image/jpeg", size: 5 });
    expect(
      await submitBatchAction({
        sheetId: sheet.id,
        questions: [{ questionId: qs[0].id, cropKeys: [foreign] }],
      }),
    ).toEqual({ ok: false, error: "That file does not belong to you." });
    expect(stored.has(foreign)).toBe(true);
  });

  it("refuses a crop that did not finish uploading, and an empty confirmation", async () => {
    const { sheet, qs, attempts: opened, user } = await ready("ba-submit-missing@test.local");
    const missing = `u/${user.id}/working/${opened[0].attemptId}/missing.jpg`;

    expect(
      await submitBatchAction({
        sheetId: sheet.id,
        questions: [{ questionId: qs[0].id, cropKeys: [missing] }],
      }),
    ).toEqual({ ok: false, error: "The upload did not finish. Please try again." });
    expect(await submitBatchAction({ sheetId: sheet.id, questions: [] })).toEqual({
      ok: false,
      error: "Give at least one region to a question.",
    });
  });

  it("refuses a demo copy without one call for each question, and another user's sheet", async () => {
    const { user, sheet, qs, cropKey } = await ready("ba-submit-demo@test.local");
    const other = await setup("ba-submit-demo-other@test.local");
    signedIn.id = user.id;
    await makeDemoCopy(user.id, 29);

    expect(
      await submitBatchAction({
        sheetId: sheet.id,
        questions: [
          { questionId: qs[0].id, cropKeys: [cropKey(0, 1)] },
          { questionId: qs[1].id, cropKeys: [cropKey(1, 2)] },
        ],
      }),
    ).toEqual({ ok: false, error: DEMO_AI_LIMIT_MESSAGE });
    await expect(
      submitBatchAction({
        sheetId: other.sheet.id,
        questions: [{ questionId: other.qs[0].id, cropKeys: [cropKey(0, 1)] }],
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("still succeeds when deleting the photos fails", async () => {
    const { sheet, qs, cropKey } = await ready("ba-submit-delete-fails@test.local");
    const storage = await import("@/lib/storage/s3");
    vi.spyOn(storage, "listObjects").mockRejectedValueOnce(new Error("storage down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await submitBatchAction({
        sheetId: sheet.id,
        questions: [{ questionId: qs[0].id, cropKeys: [cropKey(0, 1)] }],
      }),
    ).toEqual({ ok: true });
    expect(log).toHaveBeenCalled();
  });
});

describe("cancelBatchAction", () => {
  it("deletes every batch photo of the sheet and nothing else", async () => {
    const { user, sheet, photo } = await setup("ba-cancel@test.local");
    const keys = [photo(1), photo(2)];
    const elsewhere = `u/${user.id}/batch/other-sheet/p.jpg`;
    stored.set(elsewhere, { mime: "image/jpeg", size: 1 });

    await cancelBatchAction({ sheetId: sheet.id });

    for (const key of keys) expect(stored.has(key)).toBe(false);
    expect(stored.has(elsewhere)).toBe(true);
    expect(await db.select().from(attempts).where(eq(attempts.userId, user.id))).toEqual([]);
  });

  it("gives another user's sheet the 404 page", async () => {
    const { sheet } = await setup("ba-cancel-owner@test.local");
    await setup("ba-cancel-intruder@test.local");
    await expect(cancelBatchAction({ sheetId: sheet.id })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
