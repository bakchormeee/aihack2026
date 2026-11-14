import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, testSignInEnabled } from "@/lib/auth/config";

// Development and automated tests only. Returns 404 in production.
export default function TestSignInPage() {
  if (!testSignInEnabled) notFound();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Test sign-in</h1>
      <form
        className="flex flex-col gap-3"
        action={async (formData: FormData) => {
          "use server";
          await signIn("test", {
            email: String(formData.get("email") ?? ""),
            redirectTo: "/courses",
          });
        }}
      >
        <Label htmlFor="email">Email (name@test.local)</Label>
        <Input id="email" name="email" type="email" required defaultValue="dev@test.local" />
        <Button type="submit">Sign in</Button>
      </form>
    </main>
  );
}
