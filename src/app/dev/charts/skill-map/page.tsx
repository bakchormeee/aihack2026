import { notFound } from "next/navigation";

import { SkillMapDemo } from "./demo";

const base = [
  { id: "algebra", name: "Algebra", mastery: 0.85, confidence: 0.9, attempts: 14 },
  { id: "quadratics", name: "Quadratics", mastery: 0.6, confidence: 0.7, attempts: 9 },
  { id: "differentiation", name: "Differentiation", mastery: 0.35, confidence: 0.5, attempts: 7 },
  {
    id: "integration",
    name: "Integration by substitution and parts",
    mastery: 0.15,
    confidence: 0.2,
    attempts: 2,
  },
  { id: "series", name: "Series", mastery: null, confidence: 0, attempts: 0 },
  { id: "limits", name: "Limits", mastery: 1, confidence: 0.95, attempts: 4 },
];
const baseLinks = [
  { source: "algebra", target: "quadratics" },
  { source: "algebra", target: "differentiation" },
  { source: "differentiation", target: "integration" },
  { source: "limits", target: "differentiation" },
  { source: "limits", target: "series" },
];

const many = Array.from({ length: 25 }, (_, i) => ({
  id: `t${i}`,
  name: `Topic ${i + 1}`,
  mastery: i % 7 === 0 ? null : ((i * 37) % 100) / 100,
  confidence: i % 5 === 0 ? 0.1 : 0.8,
  attempts: (i * 3) % 13,
}));
const manyLinks = many
  .slice(1)
  .map((n, i) => ({ source: many[Math.floor(i / 2)].id, target: n.id }));

export default function SkillMapDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const cases: [string, typeof base, typeof baseLinks][] = [
    ["Typical course (6 topics, long name, one with no data)", base, baseLinks],
    [
      "Single topic, zero attempts",
      [{ id: "x", name: "Only topic", mastery: null, confidence: 0, attempts: 0 }],
      [],
    ],
    ["25 topics", many, manyLinks],
    ["Empty", [], []],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-4">
      <h1 className="text-xl font-semibold">SkillMap</h1>
      {cases.map(([title, nodes, links]) => (
        <section key={title} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          <SkillMapDemo nodes={nodes} links={links} />
        </section>
      ))}
    </main>
  );
}
