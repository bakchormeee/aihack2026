import { Camera, FileUp, Lightbulb, PenLine, Search } from "lucide-react";
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
    icon: FileUp,
    term: "Upload",
    body: "Drop in the sheet as a PDF. It is split into questions, each tagged with its topics.",
  },
  {
    icon: Camera,
    term: "Attempt",
    body: "Type your working or photograph it. If you are stuck, take a nudge, then an approach, then a skeleton.",
  },
  {
    icon: PenLine,
    term: "Get marked",
    body: "A score out of 5, every mistake boxed, and a hint for each one rather than the answer.",
  },
  {
    icon: Lightbulb,
    term: "Revise",
    body: "Before exams, retry what went wrong and try fresh variants of your weakest topics.",
  },
  {
    icon: Search,
    term: "Spot the error",
    body: "Hunt for the slips in a worked solution written with your own common errors planted in it.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col overflow-x-clip">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
          <BrandMark href="/" />
          <Link href="/sign-in" className="text-sm font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6">
        <section className="relative flex flex-col items-start gap-6 py-16 sm:py-24">
          <div
            aria-hidden="true"
            className="graph-paper absolute inset-x-[-50vw] inset-y-0 -z-10"
          />
          <h1 className="rise text-[2.5rem] leading-[1.08] font-medium sm:text-[3.5rem]">
            Weekly problem sheets,{" "}
            <span className="relative inline-block whitespace-nowrap">
              marked
              <svg
                aria-hidden="true"
                viewBox="0 0 200 20"
                preserveAspectRatio="none"
                className="text-pen absolute -bottom-2 left-0 h-3 w-full overflow-visible"
              >
                <path
                  d="M3 13 C 50 5, 120 4, 197 10"
                  pathLength={100}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className="pen-draw [--delay:450ms]"
                />
              </svg>
            </span>{" "}
            line by line.
          </h1>
          <p className="rise text-muted-foreground max-w-xl text-lg leading-relaxed [--delay:120ms]">
            Upload the sheet, attempt each question with up to three hints, and see{" "}
            <span className="highlight text-foreground [--delay:900ms]">every slip boxed</span> in
            your own working, a week before the official solutions come out.
          </p>
          <div className="rise flex flex-wrap items-center gap-4 [--delay:220ms]">
            <Link
              href="/courses"
              className={buttonVariants({
                size: "lg",
                className: "group transition-transform hover:-translate-y-0.5",
              })}
            >
              Open my courses
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
            <span className="text-muted-foreground text-sm">AI-marked in a minute or two.</span>
          </div>
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
                className="group grid gap-1 border-b py-4 transition-colors sm:grid-cols-[12rem_1fr] sm:gap-6"
              >
                <dt className="font-heading flex items-center gap-3 text-lg font-medium">
                  <span className="bg-card group-hover:border-pen/50 group-hover:text-pen flex size-8 items-center justify-center rounded-md border transition-colors">
                    <row.icon aria-hidden="true" className="size-4" />
                  </span>
                  {row.term}
                </dt>
                <dd className="text-muted-foreground leading-relaxed sm:pt-1">{row.body}</dd>
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
      className="rise bg-card lift relative -rotate-[0.4deg] rounded-lg border px-5 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.45)] [--delay:320ms] sm:px-6"
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
          <p className="font-heading text-pen stamp shrink-0 rounded-full border-2 border-current px-3 py-2 text-3xl leading-none italic [--delay:700ms]">
            3<span className="text-xl">/5</span>
          </p>
        </div>
        <div className="bg-background/60 rounded-md border px-4 py-3">
          <WorkingWithBoxes text={SAMPLE_WORKING} mistakes={SAMPLE_MISTAKES} />
        </div>
        <MistakeList mistakes={SAMPLE_MISTAKES} />
      </div>
    </figure>
  );
}
