// The AI limit of a demo copy (SPEC-demo.md section 3, decision 5 in tasks/plan.md).
// Pipeline entry points run their work inside `withAiUser`; `callAi` then reserves one
// call for the current user before each request. Only demo copies are counted.

import { AsyncLocalStorage } from "node:async_hooks";

import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { DEMO_AI_CALLS, aiCallsLeft } from "@/lib/demo/rules";

export const DEMO_AI_LIMIT_MESSAGE =
  "The demo limit for AI is reached. Start again for a fresh copy, or sign in with Google to use the full app.";

/** A demo copy has used all its AI calls. */
export class AiLimitError extends Error {
  constructor() {
    super(DEMO_AI_LIMIT_MESSAGE);
    this.name = "AiLimitError";
  }
}

const aiUser = new AsyncLocalStorage<string>();

/** Runs `fn` with `userId` as the user whose AI calls are counted, including work it starts asynchronously. */
export function withAiUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return aiUser.run(userId, fn);
}

/** The user set by the nearest `withAiUser`, if any. */
export function currentAiUser(): string | undefined {
  return aiUser.getStore();
}

async function demoState(userId: string) {
  const [row] = await db
    .select({ role: users.demoRole, used: users.demoAiCalls })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

/**
 * Takes one AI call from the user's budget. Real users and the template are never
 * counted (one read, no write). For a demo copy, one conditional UPDATE adds the call
 * only while it is under the limit, so parallel calls never pass it; at the limit it
 * throws `AiLimitError`.
 */
export async function reserveAiCall(userId: string): Promise<void> {
  const state = await demoState(userId);
  if (state?.role !== "copy") return;
  const reserved = await db
    .update(users)
    .set({ demoAiCalls: sql`${users.demoAiCalls} + 1` })
    .where(
      and(eq(users.id, userId), eq(users.demoRole, "copy"), lt(users.demoAiCalls, DEMO_AI_CALLS)),
    )
    .returning({ used: users.demoAiCalls });
  if (reserved.length === 0) throw new AiLimitError();
}

/** The message to refuse AI work with, for a demo copy that has no AI calls left; otherwise null. */
export async function demoAiRefusal(userId: string): Promise<string | null> {
  const state = await demoState(userId);
  if (state?.role === "copy" && aiCallsLeft(state.used) === 0) return DEMO_AI_LIMIT_MESSAGE;
  return null;
}

/**
 * The AI calls the user may still make: a number for a demo copy, null (no limit) for
 * a real user, the template or an unknown id.
 */
export async function demoAiCallsLeft(userId: string): Promise<number | null> {
  const state = await demoState(userId);
  return state?.role === "copy" ? aiCallsLeft(state.used) : null;
}
