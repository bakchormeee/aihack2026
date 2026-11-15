"use server";

import { after } from "next/server";
import { AuthError } from "next-auth";

import { eraseDemoCopy } from "@/db/queries/demo";
import { signIn, signOut } from "@/lib/auth/config";
import { getDemoInfo } from "@/lib/auth/demo-sign-in";
import { getCurrentUser } from "@/lib/auth/session";

export type DemoStartState = { error: string } | null;

const UNAVAILABLE = "The demo is not available right now. Please try again later.";

/** Signs in to a fresh demo copy and opens the courses list. */
export async function startDemo(): Promise<DemoStartState> {
  try {
    await signIn("demo", { redirectTo: "/courses" });
  } catch (error) {
    // A successful sign-in throws Next's redirect, which must pass through.
    if (error instanceof AuthError) return { error: UNAVAILABLE };
    throw error;
  }
  return null;
}

/** The copy the current session is in, when it is a demo copy. */
async function currentCopyId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const info = await getDemoInfo(user.id);
  return info?.demoRole === "copy" ? user.id : null;
}

/** Erases a demo copy after the response, without failing the request. */
function eraseLater(copyId: string) {
  after(async () => {
    try {
      await eraseDemoCopy(copyId);
    } catch (error) {
      console.error("Demo: could not erase a copy", error);
    }
  });
}

/** "Start again": a fresh copy; the old one is erased. */
export async function startAgain(): Promise<void> {
  const old = await currentCopyId();
  if (old) eraseLater(old);
  await signIn("demo", { redirectTo: "/courses" });
}

/** Signing out of a demo copy ends it. Real users sign out as before. */
export async function signOutOfApp(): Promise<void> {
  const copy = await currentCopyId();
  if (copy) eraseLater(copy);
  await signOut({ redirectTo: "/" });
}
