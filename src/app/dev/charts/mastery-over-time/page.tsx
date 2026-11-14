import { notFound } from "next/navigation";

import { MasteryOverTime } from "@/components/charts/mastery-over-time";

const day = (n: number) => new Date(Date.UTC(2026, 9, 20 + n, 10)).toISOString();

const typical = [
  {
    id: "algebra",
    name: "Algebra",
    series: [0, 2, 4, 9, 14, 19].map((d, i) => ({
      at: day(d),
      mastery: [0.3, 0.45, 0.6, 0.7, 0.82, 0.9][i],
    })),
  },
  {
    id: "calc",
    name: "Differentiation and the chain rule in several variables",
    series: [2, 9, 14, 20].map((d, i) => ({ at: day(d), mastery: [0.2, 0.15, 0.4, 0.55][i] })),
  },
  { id: "series", name: "Series", series: [{ at: day(12), mastery: 0.5 }] },
];
const events = [
  { at: day(0), kind: "sheet" as const, label: "Sheet 1" },
  { at: day(9), kind: "sheet" as const, label: "Sheet 2" },
  { at: day(15), kind: "revision" as const, label: "Weak topics session" },
];

const many = Array.from({ length: 25 }, (_, i) => ({
  id: `t${i}`,
  name: `Topic ${i + 1}`,
  series: Array.from({ length: 5 }, (_, k) => ({
    at: day(k * 4 + (i % 3)),
    mastery: Math.min(1, ((i * 13) % 50) / 100 + k * 0.1),
  })),
}));

export default function MasteryOverTimeDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-10 p-4">
      <h1 className="text-xl font-semibold">MasteryOverTime</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Typical (3 topics, long name, single-point topic)
        </h2>
        <MasteryOverTime topics={typical} events={events} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Single topic, single attempt, no events
        </h2>
        <MasteryOverTime topics={[typical[2]]} events={[]} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">25 topics</h2>
        <MasteryOverTime topics={many} events={events} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Zero attempts</h2>
        <MasteryOverTime topics={[{ id: "z", name: "Unattempted", series: [] }]} events={events} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">No topics</h2>
        <MasteryOverTime topics={[]} events={[]} />
      </section>
    </main>
  );
}
