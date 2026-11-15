import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, revisionSessions, users } from "@/db/schema";
import { DEMO_AI_LIMIT_MESSAGE } from "@/lib/ai/budget";
import { makeDemoCopy } from "@/lib/ai/test-helpers";

const signedIn = vi.hoisted(() => ({ id: "" }));
const after = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: signedIn.id, email: null, name: null }),
}));
vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { startRevisionAction, startSpotSessionAction } from "./actions";

async function copyAtLimit(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  await makeDemoCopy(user.id, 30);
  signedIn.id = user.id;
  return { user, course };
}

describe("starting a revision session and the demo AI limit", () => {
  it("refuses a long-form session for a demo copy with no AI calls left", async () => {
    const { user, course } = await copyAtLimit("rv-full@test.local");

    const result = await startRevisionAction({
      courseId: course.id,
      targetMinutes: 20,
      topicIds: [],
    });

    expect(result).toEqual({ error: DEMO_AI_LIMIT_MESSAGE });
    expect(
      await db.select().from(revisionSessions).where(eq(revisionSessions.userId, user.id)),
    ).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it("refuses a spot-the-error session for a demo copy with no AI calls left", async () => {
    const { course } = await copyAtLimit("rv-spot-full@test.local");

    const result = await startSpotSessionAction({
      courseId: course.id,
      questionCount: 5,
      topicIds: [],
    });

    expect(result).toEqual({ error: DEMO_AI_LIMIT_MESSAGE });
    expect(after).not.toHaveBeenCalled();
  });
});
