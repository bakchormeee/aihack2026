import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { MathText } from "@/components/math-text";
import { MistakeList } from "@/components/mistake-list";
import { Badge } from "@/components/ui/badge";
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
    quote: "$2xe^{2x} + \\int 2e^{2x}\\,dx$",
    hint: "Write out the integration by parts formula first. Which sign sits in front of $\\int v\\,du$?",
    location: { kind: "text" },
  },
];

const STEPS = [
  {
    title: "Upload the sheet",
    body: "Drop in this week's PDF. Each question is split out and tagged with its topic, ready to attempt.",
  },
  {
    title: "Attempt with hints",
    body: "Type or photograph your working. Stuck? Open a nudge, then an approach, then a skeleton, one rung at a time.",
  },
  {
    title: "Get marked, then revise",
    body: "Each answer is marked out of 5 with its mistakes boxed. Revision sessions pick the topics you are weakest at.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark href="/" />
          <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-24">
          <div className="flex flex-col items-start gap-6">
            <p className="text-muted-foreground text-sm font-medium">
              For weekly university maths problem sheets
            </p>
            <h1 className="max-w-xl text-4xl leading-[1.1] font-medium tracking-tight sm:text-5xl">
              See exactly where your working goes wrong.
            </h1>
            <p className="text-muted-foreground max-w-lg text-lg leading-relaxed">
              Upload a problem sheet, attempt each question with hints when you are stuck, and get
              your working marked out of 5 with every mistake boxed and explained.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/courses" className={buttonVariants({ size: "lg" })}>
                Open my courses
              </Link>
              <Link href="#how" className={buttonVariants({ variant: "outline", size: "lg" })}>
                How it works
              </Link>
            </div>
          </div>

          <SampleMark />
        </section>

        <section id="how" className="border-t">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="max-w-xl text-2xl font-medium tracking-tight sm:text-3xl">
              One sheet, three steps.{" "}
              <span className="text-muted-foreground">The same loop every week.</span>
            </h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex flex-col gap-2 border-t pt-5">
                  <span className="text-muted-foreground font-mono text-sm">0{i + 1}</span>
                  <h3 className="text-lg font-medium">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>Problem Sheet Companion</span>
          <span>Marks are AI-generated and provisional until checked against official solutions.</span>
        </div>
      </footer>
    </div>
  );
}

function SampleMark() {
  return (
    <div
      role="img"
      aria-label="Example of a marked answer: 3 out of 5, partly right, with two mistakes boxed in the working"
      className="bg-card overflow-hidden rounded-xl border shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.12)]"
    >
      <div className="bg-muted/60 flex items-center justify-between gap-3 border-b px-5 py-3 text-sm">
        <span className="font-medium">Question 2(b)</span>
        <span className="text-muted-foreground">Integration by parts</span>
      </div>
      <div className="flex flex-col gap-5 p-5">
        <MathText className="text-sm">{"Find $\\displaystyle\\int x e^{2x}\\,dx$."}</MathText>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-medium tracking-tight">3/5</span>
          <Badge variant="secondary">Partly right</Badge>
          <span className="text-muted-foreground text-xs">AI-marked, provisional</span>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <WorkingWithBoxes text={SAMPLE_WORKING} mistakes={SAMPLE_MISTAKES} />
        </div>
        <MistakeList mistakes={SAMPLE_MISTAKES} />
      </div>
    </div>
  );
}
