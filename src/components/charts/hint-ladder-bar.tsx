"use client";

import { Bar, BarChart, XAxis, YAxis } from "recharts";

import {
  HINT_LEVEL_FILLS,
  HINT_LEVEL_LABELS,
  levelPercentages,
  sanitiseCounts,
  totalSolved,
  type HintCounts,
} from "./hint-ladder";

/** Stacked bar of questions solved at hint level 0 / 1 / 2 / 3, with a labelled legend. */
export function HintLadderBar({ counts }: { counts: HintCounts }) {
  const clean = sanitiseCounts(counts);
  const total = totalSolved(clean);
  const percent = levelPercentages(clean);

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">No questions solved yet.</p>;
  }

  const datum: Record<string, number> = {};
  clean.forEach((n, i) => (datum[`l${i}`] = n));

  return (
    <figure className="w-full">
      <div
        role="img"
        aria-label={`Questions solved by hint level: ${clean
          .map((n, i) => `${HINT_LEVEL_LABELS[i]} ${n}`)
          .join(", ")}`}
      >
        <BarChart
          data={[datum]}
          layout="vertical"
          stackOffset="expand"
          responsive
          style={{ width: "100%", height: 36 }}
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis type="category" hide dataKey={() => ""} />
          {clean.map((_, i) => (
            <Bar
              key={i}
              dataKey={`l${i}`}
              stackId="hints"
              fill={HINT_LEVEL_FILLS[i]}
              stroke="var(--background)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </div>
      <figcaption>
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {clean.map((n, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: HINT_LEVEL_FILLS[i] }}
              />
              <span>
                {HINT_LEVEL_LABELS[i]}: <strong>{n}</strong>{" "}
                <span className="text-muted-foreground">({percent[i]}%)</span>
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
