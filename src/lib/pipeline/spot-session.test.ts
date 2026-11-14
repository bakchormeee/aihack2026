import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { createSpotSession } from "@/db/queries/spot";
import {
  attempts,
  courses,
  marks,
  misconceptionSources,
  misconceptions,
  questions,
  revisionSessions,
  spotItems,
  topics,
  users,
} from "@/db/schema";
import { NoCandidatesError } from "@/db/queries/revision";
import { NotFoundError } from "@/lib/auth/ownership";

import { buildSpotSession, type SpotIo } from "./spot-session";

type Write = SpotIo["write"];
type WriteInput = Parameters<Write>[0];

const solutionFor = (input: WriteInput): Awaited<ReturnType<Write>> => ({
  body: `Question about ${input.topics.join("/") || "anything"}`,
  lines: ["one", "two", "three", "four"],
  planted: input.plant.map((p, i) => ({
    line: i + 2,
    misconception: p.id,
    whatsWrong: `wrong ${p.id}`,
    correctLine: `right ${p.id}`,
  })),
  expectedMinutes: 3,
});
const okIo: SpotIo = { write: async (input) => solutionFor(input) };

/** A student with `seen.length` misconceptions, each seen in that many attempts (all on one topic). */
async function world(email: string, seen: number[] = [3, 2, 1]) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db
    .insert(courses)
    .values({ userId: user.id, name: "Analysis I" })
    .returning();
  const [topic, other] = await db
    .insert(topics)
    .values([
      { courseId: course.id, name: "Algebra" },
      { courseId: course.id, name: "Series" },
    ])
    .returning();
  let position = 0;
  const made: { id: string; description: string }[] = [];
  for (const [i, times] of seen.entries()) {
    const [m] = await db
      .insert(misconceptions)
      .values({
        userId: user.id,
        courseId: course.id,
        description: `Misconception ${i + 1}`,
        errorType: "method",
      })
      .returning();
    made.push(m);
    for (let t = 0; t < times; t++) {
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
      const [attempt] = await db
        .insert(attempts)
        .values({ userId: user.id, questionId: q.id, context: "sheet" })
        .returning();
      const [mark] = await db
        .insert(marks)
        .values({
          attemptId: attempt.id,
          basis: "ai",
          score: 2,
          outcome: "partial",
          mistakes: [],
          feedback: "f",
          overallFeedback: "o",
        })
        .returning();
      await db.insert(misconceptionSources).values({
        misconceptionId: m.id,
        markId: mark.id,
        mistakeIndex: 0,
        attemptId: attempt.id,
        topicIds: [i === 2 ? other.id : topic.id],
        quote: `quote ${i}`,
      });
    }
  }
  return { user, course, topic, other, made };
}
const itemsOf = (sessionId: string) =>
  db.select().from(spotItems).where(eq(spotItems.sessionId, sessionId)).orderBy(spotItems.position);
const sessionOf = async (id: string) =>
  (await db.select().from(revisionSessions).where(eq(revisionSessions.id, id)))[0];

describe("createSpotSession", () => {
  it("creates a building spot-the-error session sized in questions, without minutes", async () => {
    const w = await world("sp-create@test.local");

    const session = await createSpotSession(w.user.id, {
      courseId: w.course.id,
      questionCount: 10,
      topicIds: null,
    });

    expect(session).toMatchObject({
      mode: "spot_error",
      questionCount: 10,
      targetMinutes: null,
      status: "building",
      topicIds: null,
    });
  });

  it("keeps the chosen topics, and refuses a topic of another course", async () => {
    const w = await world("sp-topics@test.local");
    const stranger = await world("sp-stranger@test.local");

    const session = await createSpotSession(w.user.id, {
      courseId: w.course.id,
      questionCount: 5,
      topicIds: [w.topic.id, w.topic.id],
    });
    expect(session.topicIds).toEqual([w.topic.id]);
    await expect(
      createSpotSession(w.user.id, {
        courseId: w.course.id,
        questionCount: 5,
        topicIds: [stranger.topic.id],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses when there is nothing to plant, in the course or in the chosen topics", async () => {
    const empty = await world("sp-empty@test.local", []);
    await expect(
      createSpotSession(empty.user.id, {
        courseId: empty.course.id,
        questionCount: 5,
        topicIds: null,
      }),
    ).rejects.toBeInstanceOf(NoCandidatesError);

    const w = await world("sp-notopic@test.local", [2]);
    await expect(
      createSpotSession(w.user.id, {
        courseId: w.course.id,
        questionCount: 5,
        topicIds: [w.other.id],
      }),
    ).rejects.toBeInstanceOf(NoCandidatesError);
  });

  it("refuses another student's course", async () => {
    const a = await world("sp-a@test.local");
    const b = await world("sp-b@test.local");

    await expect(
      createSpotSession(b.user.id, { courseId: a.course.id, questionCount: 5, topicIds: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("buildSpotSession", () => {
  async function start(
    email: string,
    count = 5,
    seen?: number[],
    topicIds: string[] | null = null,
  ) {
    const w = await world(email, seen);
    const session = await createSpotSession(w.user.id, {
      courseId: w.course.id,
      questionCount: count,
      topicIds,
    });
    return { ...w, session };
  }

  it("saves the chosen number of questions in order and sets the session ready", async () => {
    const { session } = await start("sb-ok@test.local", 10);

    await buildSpotSession(session.id, okIo, () => 0.5);

    const items = await itemsOf(session.id);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await sessionOf(session.id)).status).toBe("ready");
  });

  it("plants only the student's own misconceptions, with their real ids, lines and corrections", async () => {
    const { session, made } = await start("sb-plant@test.local", 10);

    await buildSpotSession(session.id, okIo, () => 0.5);

    const items = await itemsOf(session.id);
    const planted = items.flatMap((i) => i.planted);
    expect(planted.length).toBeGreaterThan(0);
    for (const p of planted) {
      expect(made.map((m) => m.id)).toContain(p.misconceptionId);
      expect(p.correctLine).toMatch(/^right e\d$/);
    }
    // About 1 in 5 questions has no error and 1 in 5 has two.
    expect(items.filter((i) => i.planted.length === 0)).toHaveLength(2);
    expect(items.filter((i) => i.planted.length === 2)).toHaveLength(2);
  });

  it("sends each misconception's description and the student's own example to the writer", async () => {
    const { session } = await start("sb-input@test.local", 5, [2]);
    const write = vi.fn<Write>(async (input) => solutionFor(input));

    await buildSpotSession(session.id, { write }, () => 0.5);

    const inputs = write.mock.calls.map((c) => c[0]);
    expect(inputs.every((i) => i.courseName === "Analysis I")).toBe(true);
    const planting = inputs.find((i) => i.plant.length > 0)!;
    expect(planting.plant[0]).toEqual({
      id: "e1",
      description: "Misconception 1",
      example: "quote 0",
    });
    expect(planting.topics).toEqual(["Algebra"]);
  });

  it("uses the common errors seen most often before those seen once", async () => {
    const { session, made } = await start("sb-rank@test.local", 1, [1, 3, 1]);
    const write = vi.fn<Write>(async (input) => solutionFor(input));

    await buildSpotSession(session.id, { write }, () => 0.5);

    const first = write.mock.calls.map((c) => c[0].plant[0]?.description).find(Boolean);
    expect(first).toBe(made[1].description); // seen 3 times
  });

  it("only plants misconceptions seen in the chosen topics", async () => {
    const { session, made, topic } = await start(
      "sb-topics@test.local",
      5,
      [2, 2, 2],
      [] as string[],
    );
    await db
      .update(revisionSessions)
      .set({ topicIds: [topic.id] })
      .where(eq(revisionSessions.id, session.id));

    await buildSpotSession(session.id, okIo, () => 0.5);

    const used = new Set(
      (await itemsOf(session.id)).flatMap((i) => i.planted.map((p) => p.misconceptionId)),
    );
    expect(used.has(made[2].id)).toBe(false); // seen only in the other topic
    expect(used.size).toBeGreaterThan(0);
  });

  it("tries a failing question twice, then leaves it out, and the session is still ready", async () => {
    const { session } = await start("sb-drop@test.local", 5);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const write: Write = async (input) => {
      calls++;
      // The one question with no planted error never comes back right; the others do.
      if (input.plant.length === 0) throw new Error("bad reply");
      return solutionFor(input);
    };

    await buildSpotSession(session.id, { write }, () => 0.5);

    expect(calls).toBe(6);
    expect(await itemsOf(session.id)).toHaveLength(4);
    expect((await sessionOf(session.id)).status).toBe("ready");
  });

  it("fails the session when no question could be written, and a retry can succeed", async () => {
    const { session } = await start("sb-fail@test.local", 5);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await buildSpotSession(
      session.id,
      {
        write: async () => {
          throw new Error("down");
        },
      },
      () => 0.5,
    );
    expect((await sessionOf(session.id)).status).toBe("failed");
    expect(await itemsOf(session.id)).toHaveLength(0);

    await db
      .update(revisionSessions)
      .set({ status: "building" })
      .where(eq(revisionSessions.id, session.id));
    await buildSpotSession(session.id, okIo, () => 0.5);
    expect((await sessionOf(session.id)).status).toBe("ready");
  });

  it("fails the session when the common errors have gone (all hidden)", async () => {
    const { session, user } = await start("sb-hidden@test.local", 5);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db
      .update(misconceptions)
      .set({ hiddenAt: new Date() })
      .where(eq(misconceptions.userId, user.id));

    await buildSpotSession(session.id, okIo, () => 0.5);

    expect((await sessionOf(session.id)).status).toBe("failed");
  });

  it("does nothing on a rerun: no duplicate items", async () => {
    const { session } = await start("sb-rerun@test.local");
    await buildSpotSession(session.id, okIo, () => 0.5);

    await buildSpotSession(session.id, okIo, () => 0.5);

    expect(await itemsOf(session.id)).toHaveLength(5);
  });

  it("is safe when two runs overlap", async () => {
    const { session } = await start("sb-overlap@test.local");

    await Promise.all([
      buildSpotSession(session.id, okIo, () => 0.5),
      buildSpotSession(session.id, okIo, () => 0.5),
    ]);

    expect(await itemsOf(session.id)).toHaveLength(5);
    expect((await sessionOf(session.id)).status).toBe("ready");
  });

  it("ignores a session that is not building, is long-form, or does not exist", async () => {
    const { session } = await start("sb-ignore@test.local");
    const write = vi.fn<Write>(async (input) => solutionFor(input));
    await db
      .update(revisionSessions)
      .set({ status: "ready" })
      .where(eq(revisionSessions.id, session.id));
    await buildSpotSession(session.id, { write });

    const long = await start("sb-long@test.local");
    await db
      .update(revisionSessions)
      .set({ mode: "long_form", targetMinutes: 45, questionCount: null })
      .where(eq(revisionSessions.id, long.session.id));
    await buildSpotSession(long.session.id, { write });
    await buildSpotSession("does-not-exist", { write });

    expect(write).not.toHaveBeenCalled();
  });
});
