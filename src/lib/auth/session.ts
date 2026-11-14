// This file is frozen after task F3.

import { redirect } from "next/navigation";

import { auth } from "./config";

export type SessionUser = { id: string; email: string | null; name: string | null };

/** The signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? null, name: user.name ?? null };
}

/**
 * The signed-in user. Redirects to the sign-in page when there is none.
 * Call it in every server action, route handler and page that touches user
 * data: the layout guard alone is not enough, because actions can be called
 * directly.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
