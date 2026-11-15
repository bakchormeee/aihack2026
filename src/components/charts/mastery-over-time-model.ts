export type TopicSeries = { id: string; name: string; series: { at: string; mastery: number }[] };
export type TimelineEvent = { at: string; kind: "sheet" | "revision"; label: string };

/**
 * The dataviz categorical order, validated on the paper surface (worst adjacent
 * CVD ΔE 9.1). Colours are assigned in this order and never cycled: a ninth
 * topic and beyond is drawn as a thin grey "other" line, still named in the
 * legend, tooltip and table.
 */
export const LINE_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
  "#e34948",
] as const;

/** Colour for topics past the eighth. */
export const OTHER_LINE_COLOR = "#a8a294";

export function lineStyle(index: number): {
  color: string;
  dash: string | undefined;
  other: boolean;
} {
  const other = index >= LINE_COLORS.length;
  return {
    color: other ? OTHER_LINE_COLOR : LINE_COLORS[index],
    dash: other ? "2 3" : undefined,
    other,
  };
}

/** Each topic's latest value at or before time t (null if it has no point yet). */
export function valuesAt(rows: Row[], keys: string[], t: number): Record<string, number | null> {
  const out: Record<string, number | null> = Object.fromEntries(keys.map((k) => [k, null]));
  for (const row of rows) {
    if (row.t > t) break;
    for (const k of keys) if (row[k] !== undefined && row[k] !== null) out[k] = row[k];
  }
  return out;
}

export function toTime(at: string): number | null {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : null;
}

export type Row = { t: number } & Record<string, number | null>;

/**
 * Merges every topic's series into one row per timestamp (keys are topic ids).
 * Points with an invalid date are dropped; mastery is clamped to [0, 1]; rows are sorted by time.
 */
export function mergeSeries(topics: TopicSeries[]): { rows: Row[]; keys: string[] } {
  const byTime = new Map<number, Row>();
  for (const topic of topics) {
    for (const p of topic.series) {
      const t = toTime(p.at);
      if (t === null || !Number.isFinite(p.mastery)) continue;
      const row = byTime.get(t) ?? ({ t } as Row);
      row[topic.id] = Math.min(1, Math.max(0, p.mastery));
      byTime.set(t, row);
    }
  }
  const rows = [...byTime.values()].sort((a, b) => a.t - b.t);
  return { rows, keys: topics.map((t) => t.id) };
}

/** Valid events sorted by time. */
export function sortedEvents(events: TimelineEvent[]): (TimelineEvent & { t: number })[] {
  return events
    .map((e) => ({ ...e, t: toTime(e.at) }))
    .filter((e): e is TimelineEvent & { t: number } => e.t !== null)
    .sort((a, b) => a.t - b.t);
}

/** X-axis domain covering all points and events with a small margin; null when there is nothing to plot. */
export function timeDomain(rows: Row[], events: { t: number }[]): [number, number] | null {
  const times = [...rows.map((r) => r.t), ...events.map((e) => e.t)];
  if (times.length === 0) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const day = 24 * 60 * 60 * 1000;
  const pad = max === min ? day : (max - min) * 0.04;
  return [min - pad, max + pad];
}

export function formatDay(t: number): string {
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
