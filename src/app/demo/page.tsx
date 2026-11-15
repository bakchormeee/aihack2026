import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { BrandMark } from "@/components/brand-mark";
import { eraseExpiredDemoCopies } from "@/db/queries/demo";
import { demoAccess, getDemoInfo } from "@/lib/auth/demo-sign-in";
import { getCurrentUser } from "@/lib/auth/session";

import { DemoStart } from "./demo-start";

export const metadata: Metadata = { title: "Demo", robots: { index: false, follow: false } };

// The open demo link (SPEC-demo.md, section 1). A visitor with a live session goes
// straight to their courses; anyone else gets a fresh private copy.
export default async function DemoPage() {
  after(async () => {
    try {
      await eraseExpiredDemoCopies();
    } catch (error) {
      console.error("Demo: could not erase expired copies", error);
    }
  });

  const user = await getCurrentUser();
  if (user && demoAccess(await getDemoInfo(user.id), new Date()) !== "ended") {
    redirect("/courses");
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-16">
      <BrandMark href="/" />
      <div className="bg-card flex flex-col gap-6 rounded-lg border p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-tight">Demo</h1>
          <p className="text-muted-foreground text-sm">
            A student three weeks into their problem sheets. Your changes are private and are
            deleted after 24 hours.
          </p>
        </div>
        <DemoStart />
      </div>
    </main>
  );
}
