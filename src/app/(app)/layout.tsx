import { redirect } from "next/navigation";

import { signOutOfApp } from "@/app/demo/actions";
import { BrandMark } from "@/components/brand-mark";
import { DemoBanner } from "@/components/demo-banner";
import { MainNav } from "@/components/main-nav";
import { SoundToggle } from "@/components/sound-toggle";
import { Button } from "@/components/ui/button";
import { demoAccess, getDemoInfo } from "@/lib/auth/demo-sign-in";
import { requireUser } from "@/lib/auth/session";

// Every page in this group needs a signed-in user. Server actions and route
// handlers must still call requireUser() themselves.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // A demo copy that has expired or been erased starts a fresh demo.
  const access = demoAccess(await getDemoInfo(user.id), new Date());
  if (access === "ended") redirect("/demo");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background sticky top-0 z-20 border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <BrandMark href="/courses" compact />
            <MainNav />
          </div>
          <form action={signOutOfApp} className="flex items-center gap-3">
            <span className="text-muted-foreground hidden max-w-48 truncate text-sm md:inline">
              {user.email ?? user.name}
            </span>
            <SoundToggle />
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      {access === "live" ? <DemoBanner /> : null}
      <main
        id="main"
        className="rise mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 [&_h1]:text-2xl [&_h1]:font-medium [&_h1]:tracking-tight"
      >
        {children}
      </main>
    </div>
  );
}
