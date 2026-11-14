// Test sign-in: lets Playwright and agents sign in without Google. It is the
// only way into the app that bypasses Google, so it is guarded twice: it only
// works outside production AND when ENABLE_TEST_SIGN_IN=1, and it only accepts
// addresses at test.local. ENABLE_TEST_SIGN_IN must never be set on Vercel.
//
// This file is frozen after task F3.

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

export const TEST_EMAIL_DOMAIN = "test.local";

export function isTestSignInEnabled(env: {
  NODE_ENV?: string;
  ENABLE_TEST_SIGN_IN?: string;
}): boolean {
  return env.NODE_ENV !== "production" && env.ENABLE_TEST_SIGN_IN === "1";
}

export function isTestEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const at = value.lastIndexOf("@");
  return at > 0 && value.slice(at + 1) === TEST_EMAIL_DOMAIN;
}

export async function findOrCreateTestUser(email: string) {
  if (!isTestEmail(email)) throw new Error(`Not a test address: use name@${TEST_EMAIL_DOMAIN}`);

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(users)
    .values({ email, name: email.split("@")[0] })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a parallel sign-in of the same address.
  return (await db.select().from(users).where(eq(users.email, email)))[0];
}
