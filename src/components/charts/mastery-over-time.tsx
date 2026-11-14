"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import {
  formatDay,
  lineStyle,
  mergeSeries,
  sortedEvents,
  timeDomain,
  type TimelineEvent,
  type TopicSeries,
} from "./mastery-over-time-model";

export type MasteryOverTimeProps = {
  topics: TopicSeries[];
  events: TimelineEvent[];
};

/** One line per topic (mastery after each attempt) with sheet and revision events marked. */
export function MasteryOverTime({ topics, events }: MasteryOverTimeProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const { rows } = mergeSeries(topics);
  const evs = sortedEvents(events);
  const domain = timeDomain(rows, evs);

  if (rows.length === 0 || domain === null) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No marked attempts yet, so there is no mastery history to show.
      </p>
    );
  }

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <figure className="w-full min-w-0">
      <div
        role="img"
        aria-label={`Mastery over time for ${topics.length} ${topics.length === 1 ? "topic" : "topics"}, from ${formatDay(domain[0])} to ${formatDay(domain[1])}`}
      >
        <LineChart
          data={rows}
          responsive
          style={{ width: "100%", height: 300 }}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="currentColor" strokeOpacity={0.12} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            tickFormatter={formatDay}
            tick={{ fill: "currentColor", fontSize: 11 }}
            stroke="currentColor"
            tickCount={4}
            minTickGap={24}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fill: "currentColor", fontSize: 11 }}
            stroke="currentColor"
            width={38}
          />
          {evs.map((e, i) => (
            <ReferenceLine
              key={i}
              x={e.t}
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeWidth={e.kind === "sheet" ? 1.5 : 2}
              strokeDasharray={e.kind === "sheet" ? "6 4" : "1 4"}
              strokeLinecap="round"
            />
          ))}
          {topics.map((topic, i) => {
            const { color, dash } = lineStyle(i);
            return (
              <Line
                key={topic.id}
                dataKey={topic.id}
                name={topic.name}
                type="monotone"
                stroke={color}
                strokeWidth={2.5}
                strokeDasharray={dash}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                connectNulls
                hide={hidden.has(topic.id)}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </div>
      <figcaption className="mt-2 space-y-3 text-sm">
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Topics">
          {topics.map((topic, i) => {
            const { color, dash } = lineStyle(i);
            const off = hidden.has(topic.id);
            return (
              <li key={topic.id} className="min-w-0 max-w-full">
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(topic.id)}
                  className="flex max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <svg width="22" height="8" aria-hidden="true" className="shrink-0">
                    <line
                      x1="0"
                      y1="4"
                      x2="22"
                      y2="4"
                      stroke={color}
                      strokeWidth="3"
                      strokeDasharray={dash}
                      opacity={off ? 0.3 : 1}
                    />
                  </svg>
                  <span
                    className={off ? "truncate text-muted-foreground line-through" : "truncate"}
                    title={topic.name}
                  >
                    {topic.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {evs.length > 0 && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" aria-label="Events">
            {evs.map((e, i) => (
              <li key={i} className="flex items-center gap-2">
                <svg width="22" height="8" aria-hidden="true" className="shrink-0">
                  <line
                    x1="0"
                    y1="4"
                    x2="22"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth={e.kind === "sheet" ? 1.5 : 2}
                    strokeDasharray={e.kind === "sheet" ? "6 4" : "1 4"}
                    strokeLinecap="round"
                  />
                </svg>
                <span>
                  {formatDay(e.t)}: {e.kind === "sheet" ? "Sheet" : "Revision"} · {e.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}
