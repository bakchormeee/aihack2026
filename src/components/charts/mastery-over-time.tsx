"use client";

import { useState } from "react";
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  BAND_REGIONS,
  bandChange,
  bandLabelAt,
  formatDay,
  lineStyle,
  mergeSeries,
  sortedEvents,
  timeDomain,
  valuesAt,
  type Row,
  type TimelineEvent,
  type TopicSeries,
} from "./mastery-over-time-model";

export type MasteryOverTimeProps = {
  topics: TopicSeries[];
  events: TimelineEvent[];
};

const HEIGHT = 320;
const MARGIN = { top: 22, right: 120, bottom: 4, left: 0 };
/** Approximate plot height in pixels (chart minus margins and the x axis), used to keep end labels apart. */
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom - 30;
const LABEL_GAP_PX = 15;
/** Topics up to this count get their name written at the end of their line. */
const DIRECT_LABEL_MAX = 4;

/** The last row index holding a value for each topic. */
function lastIndexByTopic(rows: Row[], keys: string[]): Map<string, number> {
  const out = new Map<string, number>();
  rows.forEach((row, i) => {
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) out.set(k, i);
  });
  return out;
}

/** Vertical pixel offsets that stop end-of-line labels from overlapping. */
function labelOffsets(rows: Row[], keys: string[], last: Map<string, number>): Map<string, number> {
  const items = keys
    .filter((k) => last.has(k))
    .map((k) => {
      const v = rows[last.get(k)!][k] as number;
      return { k, y: (1 - v) * PLOT_HEIGHT };
    })
    .sort((a, b) => a.y - b.y);
  const placed: { k: string; y: number; want: number }[] = [];
  for (const it of items) {
    const prev = placed[placed.length - 1];
    const y = prev ? Math.max(it.y, prev.y + LABEL_GAP_PX) : it.y;
    placed.push({ k: it.k, y, want: it.y });
  }
  return new Map(placed.map((p) => [p.k, p.y - p.want]));
}

type TipProps = {
  active?: boolean;
  label?: number | string;
  rows: Row[];
  topics: TopicSeries[];
  hidden: ReadonlySet<string>;
};

/** One tooltip for every topic at the hovered date: value first, then the topic name. */
function ChartTooltip({ active, label, rows, topics, hidden }: TipProps) {
  if (!active || typeof label !== "number") return null;
  const values = valuesAt(
    rows,
    topics.map((t) => t.id),
    label,
  );
  const shown = topics
    .map((t, i) => ({ t, i, v: values[t.id] }))
    .filter((x) => !hidden.has(x.t.id) && x.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number));
  if (shown.length === 0) return null;
  return (
    <div className="bg-popover text-popover-foreground min-w-44 rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="text-muted-foreground mb-1.5">{formatDay(label)}</p>
      <ul className="space-y-1">
        {shown.map(({ t, i, v }) => {
          const { color, dash } = lineStyle(i);
          return (
            <li key={t.id} className="flex items-center gap-2">
              <svg width="14" height="6" aria-hidden="true" className="shrink-0">
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  stroke={color}
                  strokeWidth="2.5"
                  strokeDasharray={dash}
                />
              </svg>
              <strong className="w-24 shrink-0">{bandLabelAt(v as number)}</strong>
              <span className="text-muted-foreground truncate">{t.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One line per topic (mastery after each attempt) with numbered sheet and revision markers. */
export function MasteryOverTime({ topics, events }: MasteryOverTimeProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const { rows, keys } = mergeSeries(topics);
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

  const last = lastIndexByTopic(rows, keys);
  const visibleKeys = keys.filter((k) => !hidden.has(k));
  const direct = topics.length <= DIRECT_LABEL_MAX;
  const offsets = direct ? labelOffsets(rows, visibleKeys, last) : new Map<string, number>();

  // Summary rows for the table view: first and latest mastery per topic.
  const table = topics.map((t, i) => {
    const pts = rows.filter((r) => r[t.id] !== undefined && r[t.id] !== null);
    const first = pts.length ? (pts[0][t.id] as number) : null;
    const latest = pts.length ? (pts[pts.length - 1][t.id] as number) : null;
    return { t, i, first, latest, points: pts.length };
  });

  return (
    <figure className="w-full min-w-0">
      <div
        role="img"
        aria-label={`Mastery over time for ${topics.length} ${topics.length === 1 ? "topic" : "topics"}, from ${formatDay(domain[0])} to ${formatDay(domain[1])}. A table view follows.`}
        onMouseLeave={() => setFocus(null)}
      >
        <LineChart
          data={rows}
          responsive
          style={{ width: "100%", height: HEIGHT }}
          margin={MARGIN}
          className="text-muted-foreground"
        >
          <CartesianGrid stroke="currentColor" strokeOpacity={0.14} vertical={false} />
          {/* The vertical axis is three shaded bands, not a percentage scale. */}
          {BAND_REGIONS.map((band) => (
            <ReferenceArea
              key={band.id}
              y1={band.from}
              y2={band.to}
              fill={band.fill}
              fillOpacity={0.08}
              stroke="none"
              ifOverflow="visible"
              label={{
                value: band.label,
                position: "insideTopLeft",
                fontSize: 11,
                fontWeight: 600,
                fill: "currentColor",
                fillOpacity: 0.75,
              }}
            />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            tickFormatter={formatDay}
            tick={{ fill: "currentColor", fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.4}
            tickLine={false}
            tickCount={5}
            minTickGap={28}
          />
          <YAxis domain={[0, 1]} hide />
          {evs.map((e, i) => (
            <ReferenceLine
              key={i}
              x={e.t}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray={e.kind === "sheet" ? "5 4" : "1 3"}
              label={{
                value: `${i + 1}`,
                position: "top",
                fontSize: 10,
                fontWeight: 600,
                fill: "currentColor",
              }}
            />
          ))}
          <Tooltip
            cursor={{ stroke: "currentColor", strokeOpacity: 0.35, strokeWidth: 1 }}
            isAnimationActive={false}
            content={(p) => (
              <ChartTooltip
                active={p.active}
                label={p.label as number}
                rows={rows}
                topics={topics}
                hidden={hidden}
              />
            )}
          />
          {topics.map((topic, i) => {
            const { color, dash, other } = lineStyle(i);
            const dim = focus !== null && focus !== topic.id;
            const lastIdx = last.get(topic.id);
            return (
              <Line
                key={topic.id}
                dataKey={topic.id}
                name={topic.name}
                type="monotone"
                stroke={color}
                strokeWidth={other ? 1.5 : focus === topic.id ? 3 : 2}
                strokeOpacity={dim ? 0.18 : 1}
                strokeDasharray={dash}
                dot={false}
                activeDot={{ r: 4.5, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
                connectNulls
                hide={hidden.has(topic.id)}
                isAnimationActive={false}
                onMouseEnter={() => setFocus(topic.id)}
              >
                {direct ? (
                  <LabelList
                    dataKey={topic.id}
                    content={(props) => {
                      if (props.index !== lastIdx) return null;
                      const x = Number(props.x ?? 0);
                      const y = Number(props.y ?? 0) + (offsets.get(topic.id) ?? 0);
                      return (
                        <text
                          x={x + 8}
                          y={y}
                          dy="0.35em"
                          fontSize={12}
                          fill="var(--foreground)"
                          opacity={dim ? 0.35 : 1}
                        >
                          <tspan fill="var(--muted-foreground)">
                            {topic.name.length > 13 ? `${topic.name.slice(0, 12)}…` : topic.name}
                          </tspan>
                        </text>
                      );
                    }}
                  />
                ) : null}
              </Line>
            );
          })}
        </LineChart>
      </div>
      <figcaption className="mt-3 space-y-3 text-sm">
        <ul className="flex flex-wrap gap-x-2 gap-y-1" aria-label="Topics: select to show or hide">
          {topics.map((topic, i) => {
            const { color, dash } = lineStyle(i);
            const off = hidden.has(topic.id);
            return (
              <li key={topic.id} className="min-w-0 max-w-full">
                <button
                  type="button"
                  aria-pressed={!off}
                  onClick={() => toggle(topic.id)}
                  onMouseEnter={() => setFocus(off ? null : topic.id)}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus(off ? null : topic.id)}
                  onBlur={() => setFocus(null)}
                  className="flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                >
                  <svg width="18" height="8" aria-hidden="true" className="shrink-0">
                    <line
                      x1="0"
                      y1="4"
                      x2="18"
                      y2="4"
                      stroke={color}
                      strokeWidth="2.5"
                      strokeLinecap="round"
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
          <ol
            className="grid gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2"
            aria-label="Events"
          >
            {evs.map((e, i) => (
              <li key={i} className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-foreground">
                  {i + 1}
                </span>
                <svg width="16" height="8" aria-hidden="true" className="shrink-0">
                  <line
                    x1="0"
                    y1="4"
                    x2="16"
                    y2="4"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeDasharray={e.kind === "sheet" ? "5 4" : "1 3"}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="truncate">
                  {formatDay(e.t)} · {e.kind === "sheet" ? "Sheet" : "Revision"}: {e.label}
                </span>
              </li>
            ))}
          </ol>
        )}
        <details className="group rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Show as a table
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">Topic</th>
                  <th className="py-1 pr-4 font-medium">First</th>
                  <th className="py-1 pr-4 font-medium">Latest</th>
                  <th className="py-1 font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {table.map(({ t, first, latest }) => {
                  return (
                    <tr key={t.id}>
                      <td className="py-1.5 pr-4">{t.name}</td>
                      <td className="py-1.5 pr-4">{first === null ? "–" : bandLabelAt(first)}</td>
                      <td className="py-1.5 pr-4 font-medium">
                        {latest === null ? "–" : bandLabelAt(latest)}
                      </td>
                      <td className="py-1.5 text-muted-foreground">{bandChange(first, latest)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </figcaption>
    </figure>
  );
}
