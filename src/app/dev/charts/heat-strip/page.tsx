import { notFound } from "next/navigation";

import { HeatStrip } from "@/components/charts/heat-strip";
import type { HintLevel, Outcome } from "@/lib/domain";

const outcomes: (Outcome | null)[] = ["full", "partial", "stuck", null];

const long = Array.from({ length: 18 }, (_, i) => ({
  label: `Q${i + 1}`,
  outcome: outcomes[(i * 7) % 4],
  hintLevel: ((i * 5) % 4) as HintLevel,
}));

export default function HeatStripDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl space-y-10 p-4">
      <h1 className="text-xl font-semibold">HeatStrip</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Typical, plus edge cases</h2>
        <HeatStrip
          rows={[
            {
              sheetId: "s1",
              title: "Sheet 1: Limits and continuity",
              cells: [
                { label: "Q1", outcome: "full", hintLevel: 0 },
                { label: "Q2", outcome: "full", hintLevel: 1 },
                { label: "Q3", outcome: "partial", hintLevel: 2 },
                { label: "Q4", outcome: "stuck", hintLevel: 3 },
                { label: "Q5", outcome: null, hintLevel: 0 },
              ],
            },
            {
              sheetId: "s2",
              title:
                "Sheet 2: A very long sheet title about differentiation, the chain rule and implicit functions",
              cells: [
                { label: "Q1", outcome: "partial", hintLevel: 1 },
                { label: "Q2(b)(ii)", outcome: "full", hintLevel: 0 },
              ],
            },
            {
              sheetId: "s3",
              title: "Sheet 3: nothing attempted yet (zero attempts)",
              cells: [
                { label: "Q1", outcome: null, hintLevel: 0 },
                { label: "Q2", outcome: null, hintLevel: 0 },
                { label: "Q3", outcome: null, hintLevel: 0 },
              ],
            },
            { sheetId: "s4", title: "Sheet 4: no questions", cells: [] },
            { sheetId: "s5", title: "Sheet 5: 18 questions", cells: long },
          ]}
        />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Empty</h2>
        <HeatStrip rows={[]} />
      </section>
    </main>
  );
}
