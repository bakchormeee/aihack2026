import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">
        This page does not exist, or it belongs to another account.
      </p>
      <Link href="/courses" className={buttonVariants({ variant: "outline" })}>
        Back to my courses
      </Link>
    </main>
  );
}
