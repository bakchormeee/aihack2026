import { BrandMark } from "@/components/brand-mark";
import { MainNav } from "@/components/main-nav";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/config";
import { requireUser } from "@/lib/auth/session";

// Every page in this group needs a signed-in user. Server actions and route
// handlers must still call requireUser() themselves.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-background sticky top-0 z-20 border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-6">
            <BrandMark href="/courses" compact />
            <MainNav />
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
            className="flex items-center gap-3"
          >
            <span className="text-muted-foreground hidden max-w-48 truncate text-sm md:inline">
              {user.email ?? user.name}
            </span>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main
        id="main"
        className="rise mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 [&_h1]:text-2xl [&_h1]:font-medium [&_h1]:tracking-tight"
      >
        {children}
      </main>
    </div>
  );
}
