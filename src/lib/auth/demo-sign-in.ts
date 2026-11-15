// The demo sign-in (SPEC-demo.md, section 1): no fields, no password. Each sign-in
// makes a fresh private copy of the template student, so it can never reach the
// template, another copy or a real user.

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { createDemoCopy, DemoUnavailableError, type DemoFileIo } from "@/db/queries/demo";
import { accounts, users } from "@/db/schema";
import type { DemoRole } from "@/lib/domain";
import { isExpired } from "@/lib/demo/rules";

/** A fresh demo copy for the session, or null when the demo is not available. */
export async function authorizeDemo(now: Date = new Date(), io?: DemoFileIo) {
  try {
    const copy = await createDemoCopy(now, io);
    return { id: copy.id, name: copy.name, email: null };
  } catch (error) {
    if (error instanceof DemoUnavailableError) return null;
    throw error;
  }
}

type DemoInfo = { demoRole: DemoRole | null; demoExpiresAt: Date | null };

/**
 * What a signed-in session is: a real user, a live demo copy, or a demo that has
 * ended (the copy expired or was erased, or the session is the template's).
 */
export function demoAccess(info: DemoInfo | null, now: Date): "real" | "live" | "ended" {
  if (!info) return "ended";
  if (info.demoRole === null) return "real";
  if (info.demoRole === "copy" && !isExpired(info.demoExpiresAt, now)) return "live";
  return "ended";
}

/** The demo fields of a user, or null when the user does not exist. */
export async function getDemoInfo(userId: string): Promise<DemoInfo | null> {
  const [row] = await db
    .select({ demoRole: users.demoRole, demoExpiresAt: users.demoExpiresAt })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** A demo user can never keep a linked account: the link is removed at once. */
export async function refuseDemoLink(
  userId: string,
  account: { provider: string; providerAccountId: string },
): Promise<void> {
  const info = await getDemoInfo(userId);
  if (!info || info.demoRole === null) return;
  await db
    .delete(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.provider, account.provider),
        eq(accounts.providerAccountId, account.providerAccountId),
      ),
    );
}
