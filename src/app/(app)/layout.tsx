import Link from "next/link";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/config";
import { requireUser } from "@/lib/auth/session";

// Every page in this group needs a signed-in user. Server actions and route
// handlers must still call requireUser() themselves.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <nav aria-label="Main" className="flex items-center gap-4 text-sm">
            <Link href="/courses" className="font-semibold">
              Problem Sheet Companion
            </Link>
            <Link href="/revise" className="text-muted-foreground hover:text-foreground">
              Revise
            </Link>
          </nav>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
            className="flex items-center gap-2"
          >
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {user.email ?? user.name}
            </span>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
        {children}
      </div>
    </div>
  );
}
