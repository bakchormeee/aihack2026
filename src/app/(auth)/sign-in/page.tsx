import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { googleConfigured, signIn, testSignInEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/session";

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/courses");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

      {googleConfigured ? (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/courses" });
          }}
        >
          <Button type="submit" className="w-full">
            Continue with Google
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Google sign-in is not configured. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.
        </p>
      )}

      {testSignInEnabled ? (
        <p className="text-sm">
          <Link href="/sign-in/test" className="underline">
            Test sign-in (development only)
          </Link>
        </p>
      ) : null}
    </main>
  );
}
