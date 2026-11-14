import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Problem Sheet Companion</h1>
      <p className="text-muted-foreground">
        Upload a maths problem sheet, attempt each question with hints when you are stuck, get your
        working marked, and revise the topics you are weakest at.
      </p>
      <div>
        <Link href="/courses" className={buttonVariants()}>
          Open my courses
        </Link>
      </div>
    </main>
  );
}
