import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { loadSpotItem } from "@/db/queries/spot";
import { courses, revisionSessions, spotAnswers, spotItems, users } from "@/db/schema";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";
import { NotFoundError } from "@/lib/auth/ownership";
import type { PlantedError } from "@/lib/domain";

import { answerSpotItem, type SpotAnswerIo } from "./spot-answer";

type Judge = SpotAnswerIo["judge"];
const verdicts =
  (right: Record<number, boolean>): Judge =>
  async (input) =>
    input.lines.map((l) => ({
      line: l.line,
      right: right[l.line] ?? false,
      comment: `c${l.line}`,
    }));

const planted = (line: number): PlantedError => ({
  line,
  misconceptionId: "m",
  whatsWrong: `wrong ${line}`,
  correctLine: `right ${line}`,
});

async function setup(email: string, plantedLines: number[] = [3]) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [session] = await db
    .insert(revisionSessions)
    .values({
      userId: user.id,
      courseId: course.id,
      mode: "spot_error",
      questionCount: 5,
      status: "ready",
    })
    .returning();
  const [item] = await db
    .insert(spotItems)
    .values({
      sessionId: session.id,
      position: 1,
      body: "Question?",
      lines: ["l1", "l2", "l3", "l4", "l5"],
      planted: plantedLines.map(planted),
      topicIds: [],
    })
    .returning();
  return { user, session, item };
}
const answerRow = async (itemId: string) =>
  (await db.select().from(spotAnswers).where(eq(spotAnswers.itemId, itemId)))[0];
const tick = (line: number, explanation = "because") => ({ line, explanation });

describe("answerSpotItem", () => {
  it("is correct when the planted line is ticked and its explanation is judged right", async () => {
    const w = await setup("sa-full@test.local");

    const result = await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [tick(3)] },
      {
        judge: verdicts({ 3: true }),
      },
    );

    expect(result).toEqual({ ok: true, outcome: "full" });
    const row = await answerRow(w.item.id);
    expect(row).toMatchObject({ outcome: "full", noError: false });
    expect(row.ticked).toEqual([tick(3)]);
    expect(row.judgements).toEqual([{ line: 3, right: true, comment: "c3" }]);
    expect(row.answeredAt).not.toBeNull();
  });

  it("is stuck when the right line is ticked with a wrong explanation, and partly right with a missed second error", async () => {
    const one = await setup("sa-wrong@test.local");
    expect(
      await answerSpotItem(
        one.user.id,
        one.session.id,
        1,
        { noError: false, ticked: [tick(3)] },
        {
          judge: verdicts({ 3: false }),
        },
      ),
    ).toEqual({ ok: true, outcome: "stuck" });

    const two = await setup("sa-miss@test.local", [2, 4]);
    expect(
      await answerSpotItem(
        two.user.id,
        two.session.id,
        1,
        { noError: false, ticked: [tick(2)] },
        {
          judge: verdicts({ 2: true }),
        },
      ),
    ).toEqual({ ok: true, outcome: "partial" });
  });

  it("sends only the ticked planted lines to the AI, with the planted error and the student's explanation", async () => {
    const w = await setup("sa-send@test.local", [2, 4]);
    const judge = vi.fn<Judge>(verdicts({ 2: true }));

    await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [tick(2, " why "), tick(5)] },
      { judge },
    );

    expect(judge).toHaveBeenCalledWith({
      question: "Question?",
      lines: [
        { line: 2, text: "l2", whatsWrong: "wrong 2", correctLine: "right 2", explanation: "why" },
      ],
    });
  });

  it("does not call the AI for No error or for only wrong lines, and judges them stuck or correct in code", async () => {
    const judge = vi.fn<Judge>(verdicts({}));
    const clean = await setup("sa-clean@test.local", []);
    expect(
      await answerSpotItem(
        clean.user.id,
        clean.session.id,
        1,
        { noError: true, ticked: [] },
        { judge },
      ),
    ).toEqual({ ok: true, outcome: "full" });

    const flawed = await setup("sa-noerr@test.local");
    expect(
      await answerSpotItem(
        flawed.user.id,
        flawed.session.id,
        1,
        { noError: true, ticked: [] },
        { judge },
      ),
    ).toEqual({ ok: true, outcome: "stuck" });

    const accuse = await setup("sa-accuse@test.local");
    expect(
      await answerSpotItem(
        accuse.user.id,
        accuse.session.id,
        1,
        { noError: false, ticked: [tick(1)] },
        { judge },
      ),
    ).toEqual({ ok: true, outcome: "stuck" });
    expect(judge).not.toHaveBeenCalled();
  });

  it("refuses an invalid answer without saving anything", async () => {
    const w = await setup("sa-invalid@test.local");
    const judge = vi.fn<Judge>(verdicts({}));

    const result = await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [] },
      { judge },
    );

    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/tick the lines/i) });
    expect(await answerRow(w.item.id)).toBeUndefined();
  });

  it("takes only one answer: a second submit changes nothing", async () => {
    const w = await setup("sa-twice@test.local");
    await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [tick(3)] },
      { judge: verdicts({ 3: true }) },
    );

    const again = await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: true, ticked: [] },
      {
        judge: verdicts({}),
      },
    );

    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already answered/i) });
    expect((await answerRow(w.item.id)).outcome).toBe("full");
  });

  it("gives the answer back when the AI fails, so the student can submit again", async () => {
    const w = await setup("sa-fail@test.local");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const failed = await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [tick(3)] },
      {
        judge: async () => {
          throw new Error("down");
        },
      },
    );
    expect(failed).toMatchObject({ ok: false, error: expect.stringMatching(/try again/i) });
    expect((await answerRow(w.item.id)).answeredAt).toBeNull();

    const retry = await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: false, ticked: [tick(3)] },
      {
        judge: verdicts({ 3: true }),
      },
    );
    expect(retry).toEqual({ ok: true, outcome: "full" });
  });

  it("lets the student answer again when an answer was taken but never judged (the server died)", async () => {
    const w = await setup("sa-abandoned@test.local");
    const now = new Date("2026-11-14T12:00:00Z");
    const takenAt = (minutesAgo: number) =>
      db
        .insert(spotAnswers)
        .values({
          itemId: w.item.id,
          userId: w.user.id,
          startedAt: new Date(now.getTime() - 10 * 60_000),
          answeredAt: new Date(now.getTime() - minutesAgo * 60_000),
          ticked: [tick(1)],
        })
        .onConflictDoUpdate({
          target: spotAnswers.itemId,
          set: { answeredAt: new Date(now.getTime() - minutesAgo * 60_000) },
        });
    const submit = () =>
      answerSpotItem(
        w.user.id,
        w.session.id,
        1,
        { noError: false, ticked: [tick(3)] },
        { judge: verdicts({ 3: true }) },
        now,
      );

    // Still being judged a minute ago: not taken over.
    await takenAt(1);
    expect(await submit()).toMatchObject({ ok: false, error: expect.stringMatching(/already/i) });

    // Taken four minutes ago and never judged: abandoned, so the new answer replaces it.
    await takenAt(4);
    expect(await submit()).toEqual({ ok: true, outcome: "full" });
    const row = await answerRow(w.item.id);
    expect(row.ticked).toEqual([tick(3)]);
    expect(row.secondsSpent).toBe(600);
  });

  it("records the time spent from when the question was opened", async () => {
    const w = await setup("sa-time@test.local");
    await db.insert(spotAnswers).values({
      itemId: w.item.id,
      userId: w.user.id,
      startedAt: new Date("2026-11-14T10:00:00Z"),
    });

    await answerSpotItem(
      w.user.id,
      w.session.id,
      1,
      { noError: true, ticked: [] },
      { judge: verdicts({}) },
      new Date("2026-11-14T10:01:30Z"),
    );

    expect((await answerRow(w.item.id)).secondsSpent).toBe(90);
  });

  it("is a 404 for another student's question, a missing position, or a long-form session", async () => {
    const w = await setup("sa-own@test.local");
    const other = await setup("sa-other@test.local");
    const io = { judge: verdicts({}) };

    await expect(
      answerSpotItem(other.user.id, w.session.id, 1, { noError: true, ticked: [] }, io),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      answerSpotItem(w.user.id, w.session.id, 9, { noError: true, ticked: [] }, io),
    ).rejects.toBeInstanceOf(NotFoundError);
    await db
      .update(revisionSessions)
      .set({ mode: "long_form", targetMinutes: 20 })
      .where(eq(revisionSessions.id, w.session.id));
    await expect(loadSpotItem(w.user.id, w.session.id, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("counts the judging as one AI call of a demo copy", async () => {
    const w = await setup("sa-demo@test.local");
    await makeDemoCopy(w.user.id);
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await answerSpotItem(w.user.id, w.session.id, 1, {
      noError: false,
      ticked: [tick(3)],
    });

    vi.unstubAllEnvs();
    expect(result).toEqual({ ok: true, outcome: "full" });
    expect(await demoCallsOf(w.user.id)).toBe(1);
  });
});
