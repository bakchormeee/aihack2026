import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { MathText } from "@/components/math-text";
import { MistakeList } from "@/components/mistake-list";
import { buttonVariants } from "@/components/ui/button";
import { WorkingWithBoxes } from "@/components/working-with-boxes";
import type { Mistake } from "@/lib/domain";

// A sample mark, drawn with the same components as the real mark screen.
const SAMPLE_WORKING = [
  "Let $u = x$ and $dv = e^{2x}\\,dx$, so $v = 2e^{2x}$.",
  "$\\int x e^{2x}\\,dx = 2xe^{2x} + \\int 2e^{2x}\\,dx$",
  "$= 2xe^{2x} + e^{2x} + C$",
].join("\n");

const SAMPLE_MISTAKES: Mistake[] = [
  {
    type: "algebra_slip",
    quote: "$v = 2e^{2x}$",
    hint: "Differentiate your $v$. Do you get back $e^{2x}$?",
    location: { kind: "text" },
  },
  {
    type: "method",
    quote: "$\\int x e^{2x}\\,dx = 2xe^{2x} + \\int 2e^{2x}\\,dx$",
    hint: "Write out the integration by parts formula first. Which sign sits in front of $\\int v\\,du$?",
    location: { kind: "text" },
  },
];

const WEEK = [
  {
    term: "Upload",
    body: "Drop in the sheet as a PDF. It is split into questions, each tagged with its topics.",
  },
  {
    term: "Attempt",
    body: "Type your working or photograph it. If you are stuck, take a nudge, then an approach, then a skeleton.",
  },
  {
    term: "Get marked",
    body: "A score out of 5, every mistake boxed, and a hint for each one rather than the answer.",
  },
  {
    term: "Revise",
    body: "Before exams, retry what went wrong and try fresh variants of your weakest topics.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <BrandMark href="/" />
          <Link href="/sign-in" className="text-sm font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6">
        <section className="flex flex-col items-start gap-6 py-16 sm:py-20">
          <h1 className="text-[2.5rem] leading-[1.08] font-medium sm:text-[3.25rem]">
            Weekly problem sheets, marked line by line.
          </h1>
          <p className="text-muted-foreground max-w-xl text-lg leading-relaxed">
            Upload the sheet, attempt each question with up to three hints, and see every slip boxed
            in your own working, a week before the official solutions come out.
          </p>
          <Link href="/courses" className={buttonVariants({ size: "lg" })}>
            Open my courses
          </Link>
        </section>

        <SampleMark />

        <section aria-labelledby="week" className="py-16 sm:py-20">
          <h2 id="week" className="text-2xl font-medium">
            What you do each week
          </h2>
          <dl className="mt-6 border-t">
            {WEEK.map((row) => (
              <div
                key={row.term}
                className="grid gap-1 border-b py-4 sm:grid-cols-[10rem_1fr] sm:gap-6"
              >
                <dt className="font-heading text-lg font-medium">{row.term}</dt>
                <dd className="text-muted-foreground leading-relaxed">{row.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 py-6 text-sm sm:flex-row sm:justify-between sm:px-6">
          <span>Problem Sheet Companion</span>
          <span>AI marks are provisional until checked against official solutions.</span>
        </div>
      </footer>
    </div>
  );
}

/** One question from a sheet, as the mark screen shows it after submitting. */
function SampleMark() {
  return (
    <figure
      aria-label="Example: question 2(b) marked 3 out of 5, with two mistakes boxed in the working"
      className="border-foreground border-t-2"
    >
      <div className="text-muted-foreground flex items-baseline justify-between border-b py-2 font-mono text-xs">
        <span>Sheet 3 · Integration</span>
        <span>AI-marked, provisional</span>
      </div>
      <div className="flex flex-col gap-6 py-6">
        <div className="flex items-start justify-between gap-6">
          <div className="font-heading flex gap-3 text-lg">
            <span className="font-medium">2(b)</span>
            <MathText>{"Find $\\displaystyle\\int x e^{2x}\\,dx$."}</MathText>
          </div>
          <p className="font-heading text-pen shrink-0 text-3xl leading-none italic">
            3<span className="text-xl">/5</span>
          </p>
        </div>
        <div className="bg-card rounded-md border px-4 py-3">
          <WorkingWithBoxes text={SAMPLE_WORKING} mistakes={SAMPLE_MISTAKES} />
        </div>
        <MistakeList mistakes={SAMPLE_MISTAKES} />
      </div>
    </figure>
  );
}
