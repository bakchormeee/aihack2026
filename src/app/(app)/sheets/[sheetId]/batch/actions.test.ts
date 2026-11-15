import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, questions, sheets, users } from "@/db/schema";
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

import { proposeBatchAction } from "./actions";

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
    const { eq } = await import("drizzle-orm");
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
