import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { DEMO_AI_CALLS } from "@/lib/demo/rules";

import {
  AiLimitError,
  DEMO_AI_LIMIT_MESSAGE,
  currentAiUser,
  demoAiRefusal,
  reserveAiCall,
  withAiUser,
} from "./budget";
import { callAi, setAiClient } from "./client";
import { fakeAi } from "./test-helpers";

let n = 0;
async function newUser(role: "copy" | "template" | null, used = 0) {
  const [user] = await db
    .insert(users)
    .values({ email: `budget-${n++}@test.local`, demoRole: role, demoAiCalls: used })
    .returning();
  return user.id;
}
const usedBy = async (id: string) =>
  (await db.select().from(users).where(eq(users.id, id)))[0].demoAiCalls;

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("withAiUser", () => {
  it("sets the current user for the work it runs, including async work it starts", async () => {
    expect(currentAiUser()).toBeUndefined();
    const seen = await withAiUser("u1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Promise.all([1, 2].map(async () => currentAiUser()));
    });
    expect(seen).toEqual(["u1", "u1"]);
    expect(currentAiUser()).toBeUndefined();
  });
});

describe("reserveAiCall", () => {
  it("counts the calls of a demo copy and refuses the one after the limit", async () => {
    const id = await newUser("copy");
    for (let i = 0; i < DEMO_AI_CALLS; i++) await reserveAiCall(id);
    expect(await usedBy(id)).toBe(30);

    await expect(reserveAiCall(id)).rejects.toBeInstanceOf(AiLimitError);
    await expect(reserveAiCall(id)).rejects.toThrow(DEMO_AI_LIMIT_MESSAGE);
    expect(await usedBy(id)).toBe(30);
  });

  it("never counts a real user or the template", async () => {
    const real = await newUser(null);
    const template = await newUser("template", 30);
    for (let i = 0; i < 35; i++) {
      await reserveAiCall(real);
      await reserveAiCall(template);
    }
    expect(await usedBy(real)).toBe(0);
    expect(await usedBy(template)).toBe(30);
  });

  it("never lets parallel calls pass the limit", async () => {
    const id = await newUser("copy");
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => reserveAiCall(id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(10);
    for (const r of refused) expect(r.reason).toBeInstanceOf(AiLimitError);
    expect(await usedBy(id)).toBe(30);
  });
});

describe("demoAiRefusal", () => {
  it("refuses only a demo copy with no calls left", async () => {
    expect(await demoAiRefusal(await newUser("copy", 29))).toBeNull();
    expect(await demoAiRefusal(await newUser("copy", 30))).toBe(DEMO_AI_LIMIT_MESSAGE);
    expect(await demoAiRefusal(await newUser("template", 30))).toBeNull();
    expect(await demoAiRefusal(await newUser(null, 30))).toBeNull();
    expect(await demoAiRefusal("no-such-user")).toBeNull();
  });
});

describe("callAi with a current user", () => {
  const schema = z.object({ ok: z.boolean() });
  const args = { callName: "budgetTest", schema, system: "s", text: "t" };

  it("counts each request of a demo copy, including the retry of an invalid reply", async () => {
    const id = await newUser("copy");
    fakeAi({ ok: true });
    await withAiUser(id, () => callAi(args));
    expect(await usedBy(id)).toBe(1);

    fakeAi({ wrong: 1 }, { ok: true }); // the first reply is invalid, so a second request is made
    await withAiUser(id, () => callAi(args));
    expect(await usedBy(id)).toBe(3);
  });

  it("makes no request once the limit is reached", async () => {
    const id = await newUser("copy", 30);
    const create = fakeAi({ ok: true });
    await expect(withAiUser(id, () => callAi(args))).rejects.toBeInstanceOf(AiLimitError);
    expect(create).not.toHaveBeenCalled();
  });

  it("counts a fixture answer", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    const id = await newUser("copy");
    await withAiUser(id, () =>
      callAi({ ...args, callName: "markAttempt", schema: z.object({}).passthrough() }),
    );
    expect(await usedBy(id)).toBe(1);
  });

  it("does not count a call without a current user, or of a real user", async () => {
    const copy = await newUser("copy");
    const real = await newUser(null);
    fakeAi({ ok: true }, { ok: true });
    await callAi(args);
    await withAiUser(real, () => callAi(args));
    expect(await usedBy(copy)).toBe(0);
    expect(await usedBy(real)).toBe(0);
  });
});
