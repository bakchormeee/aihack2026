import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { attempts, courses, questions, sheets, submissions, users } from "@/db/schema";
import { AiLimitError } from "@/lib/ai/budget";
import { setAiClient } from "@/lib/ai/client";
import { matchWorking } from "@/lib/ai/match-working";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";
import { CROP_MARGIN } from "@/lib/batch/regions";
import { NotFoundError } from "@/lib/auth/ownership";

import { BatchProposalError, proposeBatch, type MatchIo } from "./match-working";

const LABELS = ["1", "2(a)", "2(b)", "3"];

async function setup(email: string, status: "ready" | "parsing" = "ready") {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status })
    .returning();
  const qs = await db
    .insert(questions)
    .values(
      LABELS.map((label, i) => ({
        courseId: course.id,
        sheetId: sheet.id,
        position: i + 1,
        label,
        body: `Body ${label}`,
        expectedMinutes: 5,
      })),
    )
    .returning();
  return { user, sheet, qs };
}

async function submitted(userId: string, questionId: string, at = new Date()) {
  const [attempt] = await db
    .insert(attempts)
    .values({ userId, questionId, context: "sheet", startedAt: at })
    .returning();
  await db.insert(submissions).values({ attemptId: attempt.id, text: "x", submittedAt: at });
  return attempt;
}

const photos = [
  { key: "u/x/batch/s/a.jpg", mime: "image/jpeg" },
  { key: "u/x/batch/s/b.png", mime: "image/png" },
];

function fakeIo(regions: Awaited<ReturnType<typeof matchWorking>> = []) {
  const match = vi.fn(async (input: Parameters<typeof matchWorking>[0]) => {
    void input;
    return regions;
  });
  const io: MatchIo = { readFile: async (key) => Buffer.from(key), match };
  return { io, match };
}

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("proposeBatch", () => {
  it("groups the fixture's regions by question id, with the run over two photos and the unmatched one", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    const { user, sheet, qs } = await setup("mw-fixture@test.local");

    const result = await proposeBatch(user.id, sheet.id, photos, {
      readFile: async () => Buffer.from("photo"),
      match: matchWorking,
    });

    expect(result.matched.map((m) => m.questionId)).toEqual(qs.map((q) => q.id));
    const twoB = result.matched[2];
    expect(twoB.regions.map((r) => r.photo)).toEqual([0, 1]);
    expect(result.matched[0].regions[0].box.x).toBeCloseTo(0.05 - CROP_MARGIN);
    expect(result.unmatched).toHaveLength(1);
    expect(result.skipped).toEqual([]);
    expect(result.questions.map((q) => q.label)).toEqual(LABELS);
  });

  it("sends the photos in order with their types, and only the questions that can take working", async () => {
    const { user, sheet, qs } = await setup("mw-skip@test.local");
    await submitted(user.id, qs[1].id);
    const { io, match } = fakeIo();

    const result = await proposeBatch(user.id, sheet.id, photos, io);

    const input = match.mock.calls[0][0];
    expect(input.photos.map((p) => [p.mime, p.data.toString()])).toEqual([
      ["image/jpeg", photos[0].key],
      ["image/png", photos[1].key],
    ]);
    expect(input.questions).toEqual([
      { label: "1", body: "Body 1" },
      { label: "2(b)", body: "Body 2(b)" },
      { label: "3", body: "Body 3" },
    ]);
    expect(result.skipped).toEqual([{ questionId: qs[1].id, label: "2(a)" }]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([]);
  });

  it("makes a region for a skipped question unmatched", async () => {
    const { user, sheet, qs } = await setup("mw-skipped-label@test.local");
    await submitted(user.id, qs[0].id);
    const { io } = fakeIo([
      { photo: 0, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 }, questionLabel: "1" },
    ]);

    const result = await proposeBatch(user.id, sheet.id, photos, io);

    expect(result.matched).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it("counts a question whose latest attempt is open again (a retry) as able to take working", async () => {
    const { user, sheet, qs } = await setup("mw-retry@test.local");
    await submitted(user.id, qs[0].id, new Date(Date.now() - 60_000));
    await db.insert(attempts).values({ userId: user.id, questionId: qs[0].id, context: "sheet" });
    const { io } = fakeIo();

    expect((await proposeBatch(user.id, sheet.id, photos, io)).skipped).toEqual([]);
  });

  it("ignores attempts in a revision session and attempts of other users", async () => {
    const { user, sheet, qs } = await setup("mw-other@test.local");
    const [other] = await db.insert(users).values({ email: "mw-other2@test.local" }).returning();
    await submitted(other.id, qs[0].id);
    const { io } = fakeIo();

    expect((await proposeBatch(user.id, sheet.id, photos, io)).skipped).toEqual([]);
  });

  it("refuses a sheet that is not ready, or with nothing that can take working, without calling the AI", async () => {
    const parsing = await setup("mw-parsing@test.local", "parsing");
    const { io, match } = fakeIo();
    await expect(proposeBatch(parsing.user.id, parsing.sheet.id, photos, io)).rejects.toThrow(
      new BatchProposalError("This sheet is not ready yet."),
    );

    const done = await setup("mw-done@test.local");
    for (const q of done.qs) await submitted(done.user.id, q.id);
    await expect(proposeBatch(done.user.id, done.sheet.id, photos, io)).rejects.toThrow(
      "Every question on this sheet already has submitted working.",
    );
    await expect(proposeBatch(parsing.user.id, done.sheet.id, photos, io)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const empty = await setup("mw-nophoto@test.local");
    await expect(proposeBatch(empty.user.id, empty.sheet.id, [], io)).rejects.toThrow(
      "Choose at least one photo.",
    );
    expect(match).not.toHaveBeenCalled();
  });

  it("gives a sheet with no questions as having nothing to match", async () => {
    const [user] = await db.insert(users).values({ email: "mw-noq@test.local" }).returning();
    const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
    const [sheet] = await db
      .insert(sheets)
      .values({ courseId: course.id, title: "S", status: "ready" })
      .returning();
    await expect(proposeBatch(user.id, sheet.id, photos, fakeIo().io)).rejects.toBeInstanceOf(
      BatchProposalError,
    );
  });

  it("counts the matching as one AI call of a demo copy, and stops at the limit", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    const { user, sheet } = await setup("mw-demo@test.local");
    await makeDemoCopy(user.id, 29);
    const io = { readFile: async () => Buffer.from("p"), match: matchWorking };

    await proposeBatch(user.id, sheet.id, photos, io);
    expect(await demoCallsOf(user.id)).toBe(30);
    await expect(proposeBatch(user.id, sheet.id, photos, io)).rejects.toBeInstanceOf(AiLimitError);
  });
});
