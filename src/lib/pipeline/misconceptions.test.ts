import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { hideMisconception, listMisconceptions } from "@/db/queries/misconceptions";
import {
  attempts,
  courses,
  marks,
  misconceptionJobs,
  misconceptionMarks,
  misconceptions,
  questionTopics,
  questions,
  topics,
  users,
} from "@/db/schema";
import { demoCallsOf, makeDemoCopy } from "@/lib/ai/test-helpers";
import { NotFoundError } from "@/lib/auth/ownership";
import type { ErrorType, Mistake } from "@/lib/domain";
import { STALE_JOB_MS } from "@/lib/domain";

import {
  MAX_MISTAKES_PER_CALL,
  refreshMisconceptions,
  type MisconceptionIo,
} from "./misconceptions";

type Group = MisconceptionIo["group"];

const mistake = (type: ErrorType, quote: string): Mistake => ({
  type,
  quote,
  hint: "h",
  location: { kind: "text" },
});

async function world(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [topic] = await db
    .insert(topics)
    .values({ courseId: course.id, name: "Algebra" })
    .returning();
  let position = 0;
  let clock = 0;
  const addMark = async (
    o: {
      mistakes?: Mistake[] | null;
      firstWrongStep?: string | null;
      errorType?: ErrorType | null;
      basis?: "ai" | "official";
      attemptId?: string;
    } = {},
  ) => {
    let attemptId = o.attemptId;
    if (!attemptId) {
      const [q] = await db
        .insert(questions)
        .values({
          courseId: course.id,
          position: ++position,
          label: `Q${position}`,
          body: "B",
          expectedMinutes: 5,
        })
        .returning();
      await db.insert(questionTopics).values({ questionId: q.id, topicId: topic.id });
      [{ id: attemptId }] = await db
        .insert(attempts)
        .values({ userId: user.id, questionId: q.id, context: "sheet" })
        .returning({ id: attempts.id });
    }
    const [mark] = await db
      .insert(marks)
      .values({
        attemptId,
        basis: o.basis ?? "ai",
        score: 3,
        outcome: "partial",
        mistakes: o.mistakes === undefined ? [mistake("algebra_slip", "q1")] : o.mistakes,
        firstWrongStep: o.firstWrongStep ?? null,
        errorType: o.errorType ?? null,
        feedback: "f",
        overallFeedback: "o",
        createdAt: new Date(Date.UTC(2026, 10, 1) + ++clock * 1000),
      })
      .returning();
    return { mark, attemptId };
  };
  return { user, course, topic, addMark };
}

const readMarksOf = (w: { user: { id: string } }) =>
  db.select().from(misconceptionMarks).where(eq(misconceptionMarks.userId, w.user.id));
const jobOf = async (w: { user: { id: string } }) =>
  (await db.select().from(misconceptionJobs).where(eq(misconceptionJobs.userId, w.user.id)))[0];
const rowsOf = (w: { user: { id: string } }) =>
  db.select().from(misconceptions).where(eq(misconceptions.userId, w.user.id));

/** A fake grouper that puts every mistake in one new misconception per distinct quote. */
const byQuote =
  (log: { calls: Parameters<Group>[0][] } = { calls: [] }): Group =>
  async (input) => {
    log.calls.push(input);
    return input.mistakes.map((m) => ({ mistake: m.n, description: `Error with ${m.quote}` }));
  };

describe("refreshMisconceptions", () => {
  it("builds the first list from old and new marks, with sources, topics and read marks", async () => {
    const w = await world("mc-first@test.local");
    await w.addMark({ mistakes: [mistake("algebra_slip", "a"), mistake("method", "b")] });
    await w.addMark({ mistakes: null, firstWrongStep: "old step", errorType: "conceptual" });

    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote() });

    const list = await listMisconceptions(w.user.id, w.course.id);
    expect(list.map((m) => m.description).sort()).toEqual([
      "Error with a",
      "Error with b",
      "Error with old step",
    ]);
    const old = list.find((m) => m.description === "Error with old step")!;
    expect(old).toMatchObject({ errorType: "conceptual", timesSeen: 1, example: "old step" });
    expect(old.topicIds).toEqual([w.topic.id]);
    expect(await readMarksOf(w)).toHaveLength(2);
    expect((await jobOf(w)).status).toBe("ready");
  });

  it("sends only the marks it has not read, with existing misconceptions numbered and hidden ones flagged", async () => {
    const w = await world("mc-new@test.local");
    await w.addMark({ mistakes: [mistake("algebra_slip", "first")] });
    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote() });
    const [only] = await rowsOf(w);
    await hideMisconception(w.user.id, only.id);
    await w.addMark({ mistakes: [mistake("method", "second")] });
    const log = { calls: [] as Parameters<Group>[0][] };

    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote(log) });

    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].mistakes.map((m) => m.quote)).toEqual(["second"]);
    expect(log.calls[0].existing).toEqual([
      { id: "m1", description: "Error with first", hidden: true },
    ]);
  });

  it("puts a mistake in an existing misconception, and the hidden one stays hidden", async () => {
    const w = await world("mc-hidden@test.local");
    await w.addMark({ mistakes: [mistake("algebra_slip", "first")] });
    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote() });
    const [only] = await rowsOf(w);
    await hideMisconception(w.user.id, only.id);
    await w.addMark({ mistakes: [mistake("algebra_slip", "again")] });

    await refreshMisconceptions(w.user.id, w.course.id, {
      group: async (i) => i.mistakes.map((m) => ({ mistake: m.n, existing: "m1" })),
    });

    const list = await listMisconceptions(w.user.id, w.course.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ hidden: true, timesSeen: 2, example: "again" });
  });

  it("counts an attempt once however many of its mistakes are in the misconception", async () => {
    const w = await world("mc-once@test.local");
    await w.addMark({ mistakes: [mistake("algebra_slip", "x"), mistake("algebra_slip", "y")] });

    await refreshMisconceptions(w.user.id, w.course.id, {
      group: async (i) =>
        [
          { mistake: 1, description: "Same error" },
          { mistake: 2, description: "Same error" },
        ].filter((p) => i.mistakes.some((m) => m.n === p.mistake)),
    });

    const list = await listMisconceptions(w.user.id, w.course.id);
    expect(list).toHaveLength(1); // two mistakes with one description share one misconception
    expect(list[0].timesSeen).toBe(1);
  });

  it("counts distinct attempts, and stops counting an attempt whose mark was replaced", async () => {
    const w = await world("mc-superseded@test.local");
    const first = await w.addMark({ mistakes: [mistake("algebra_slip", "slip")] });
    await w.addMark({ mistakes: [mistake("algebra_slip", "slip")] });
    const same: Group = async (i) =>
      i.mistakes.map((m) => ({ mistake: m.n, description: "Sign slip" }));
    await refreshMisconceptions(w.user.id, w.course.id, { group: same });
    expect((await listMisconceptions(w.user.id, w.course.id))[0].timesSeen).toBe(2);

    // A dispute gives the first attempt a new current mark with no mistakes.
    await w.addMark({ attemptId: first.attemptId, mistakes: [] });

    expect((await listMisconceptions(w.user.id, w.course.id))[0].timesSeen).toBe(1);
  });

  it("an official mark replaces the AI mark as the one that counts", async () => {
    const w = await world("mc-official@test.local");
    const first = await w.addMark({ mistakes: [mistake("algebra_slip", "slip")] });
    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote() });
    expect((await listMisconceptions(w.user.id, w.course.id))[0].timesSeen).toBe(1);

    await w.addMark({ attemptId: first.attemptId, basis: "official", mistakes: [] });

    expect((await listMisconceptions(w.user.id, w.course.id))[0].timesSeen).toBe(0);
  });

  it("reads marks that have no mistakes without calling the AI", async () => {
    const w = await world("mc-clean@test.local");
    await w.addMark({ mistakes: [] });
    await w.addMark({ mistakes: null, firstWrongStep: null });
    const group = vi.fn<Group>(async () => []);

    await refreshMisconceptions(w.user.id, w.course.id, { group });

    expect(group).not.toHaveBeenCalled();
    expect(await readMarksOf(w)).toHaveLength(2);
  });

  it("ignores placements the AI leaves out, and an old mark with no error type counts as a method error", async () => {
    const w = await world("mc-left@test.local");
    await w.addMark({ mistakes: null, firstWrongStep: "vague", errorType: null });

    await refreshMisconceptions(w.user.id, w.course.id, { group: async () => [] });
    expect(await listMisconceptions(w.user.id, w.course.id)).toEqual([]);

    const log = { calls: [] as Parameters<Group>[0][] };
    await w.addMark({ mistakes: null, firstWrongStep: "other", errorType: null });
    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote(log) });
    expect(log.calls[0].mistakes[0].type).toBe("method");
  });

  it("sends at most 40 mistakes per call and keeps going until every mark is read", async () => {
    const w = await world("mc-batch@test.local");
    for (let i = 0; i < 6; i++)
      await w.addMark({
        mistakes: Array.from({ length: 8 }, (_, j) => mistake("method", `m${i}-${j}`)),
      });
    const log = { calls: [] as Parameters<Group>[0][] };

    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote(log) });

    expect(log.calls.map((c) => c.mistakes.length)).toEqual([40, 8]);
    expect(MAX_MISTAKES_PER_CALL).toBe(40);
    expect(await readMarksOf(w)).toHaveLength(6);
  });

  it("picks up a mark that arrives while it is running", async () => {
    const w = await world("mc-arrives@test.local");
    await w.addMark({ mistakes: [mistake("method", "one")] });
    let calls = 0;
    const group: Group = async (i) => {
      if (++calls === 1) await w.addMark({ mistakes: [mistake("method", "two")] });
      return i.mistakes.map((m) => ({ mistake: m.n, description: `Error with ${m.quote}` }));
    };

    await refreshMisconceptions(w.user.id, w.course.id, { group });

    expect(calls).toBe(2);
    expect(await listMisconceptions(w.user.id, w.course.id)).toHaveLength(2);
  });

  it("leaves the marks unread and the job failed when the AI fails, and a later run succeeds", async () => {
    const w = await world("mc-fail@test.local");
    await w.addMark({ mistakes: [mistake("method", "one")] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await refreshMisconceptions(w.user.id, w.course.id, {
      group: async () => {
        throw new Error("down");
      },
    });
    expect((await jobOf(w)).status).toBe("failed");
    expect(await readMarksOf(w)).toHaveLength(0);

    await refreshMisconceptions(w.user.id, w.course.id, { group: byQuote() });
    expect((await jobOf(w)).status).toBe("ready");
    expect(await listMisconceptions(w.user.id, w.course.id)).toHaveLength(1);
  });

  it("does nothing while another run holds the job, and takes over a stale one", async () => {
    const w = await world("mc-claim@test.local");
    await w.addMark({ mistakes: [mistake("method", "one")] });
    await db.insert(misconceptionJobs).values({ userId: w.user.id, courseId: w.course.id });
    const group = vi.fn(byQuote());

    await refreshMisconceptions(w.user.id, w.course.id, { group });
    expect(group).not.toHaveBeenCalled();

    await db
      .update(misconceptionJobs)
      .set({ statusUpdatedAt: new Date(Date.now() - STALE_JOB_MS - 1000) })
      .where(eq(misconceptionJobs.userId, w.user.id));
    await refreshMisconceptions(w.user.id, w.course.id, { group });
    expect(group).toHaveBeenCalledTimes(1);
  });

  it("is safe when two runs overlap: the mistakes are placed once", async () => {
    const w = await world("mc-overlap@test.local");
    await w.addMark({ mistakes: [mistake("method", "one")] });
    const io = { group: byQuote() };

    await Promise.all([
      refreshMisconceptions(w.user.id, w.course.id, io),
      refreshMisconceptions(w.user.id, w.course.id, io),
    ]);

    expect(await listMisconceptions(w.user.id, w.course.id)).toHaveLength(1);
  });

  it("only uses this student's marks and this course", async () => {
    const mine = await world("mc-mine@test.local");
    const other = await world("mc-other@test.local");
    await mine.addMark({ mistakes: [mistake("method", "mine")] });
    await other.addMark({ mistakes: [mistake("method", "theirs")] });
    const log = { calls: [] as Parameters<Group>[0][] };

    await refreshMisconceptions(mine.user.id, mine.course.id, { group: byQuote(log) });

    expect(log.calls[0].mistakes.map((m) => m.quote)).toEqual(["mine"]);
    expect(await listMisconceptions(other.user.id, other.course.id)).toEqual([]);
  });

  it("counts the grouping as one AI call of a demo copy", async () => {
    const w = await world("mc-demo@test.local");
    await w.addMark({ mistakes: [mistake("algebra_slip", "a"), mistake("method", "b")] });
    await makeDemoCopy(w.user.id);
    vi.stubEnv("AI_FIXTURES", "1");

    await refreshMisconceptions(w.user.id, w.course.id);

    vi.unstubAllEnvs();
    expect((await jobOf(w)).status).toBe("ready");
    expect(await demoCallsOf(w.user.id)).toBe(1);
  });
});

describe("hideMisconception and listMisconceptions", () => {
  it("hides one misconception and refuses another student's", async () => {
    const a = await world("hide-a@test.local");
    const b = await world("hide-b@test.local");
    await a.addMark({ mistakes: [mistake("method", "x")] });
    await refreshMisconceptions(a.user.id, a.course.id, { group: byQuote() });
    const [row] = await db
      .select()
      .from(misconceptions)
      .where(eq(misconceptions.userId, a.user.id));

    await expect(hideMisconception(b.user.id, row.id)).rejects.toBeInstanceOf(NotFoundError);
    await hideMisconception(a.user.id, row.id);

    expect((await listMisconceptions(a.user.id, a.course.id))[0].hidden).toBe(true);
  });

  it("refuses another student's course and lists nothing for a course with no misconceptions", async () => {
    const a = await world("list-a@test.local");
    const b = await world("list-b@test.local");

    await expect(listMisconceptions(b.user.id, a.course.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMisconceptions(a.user.id, a.course.id)).toEqual([]);
  });

  it("lists the most often seen first", async () => {
    const w = await world("list-order@test.local");
    await w.addMark({ mistakes: [mistake("method", "rare")] });
    await w.addMark({ mistakes: [mistake("algebra_slip", "common")] });
    await w.addMark({ mistakes: [mistake("algebra_slip", "common")] });
    const group: Group = async (i) =>
      i.mistakes.map((m) => ({
        mistake: m.n,
        description: m.quote === "rare" ? "Rare" : "Common",
      }));
    await refreshMisconceptions(w.user.id, w.course.id, { group });

    expect((await listMisconceptions(w.user.id, w.course.id)).map((m) => m.description)).toEqual([
      "Common",
      "Rare",
    ]);
  });
});
