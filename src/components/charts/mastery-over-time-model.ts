export type TopicSeries = { id: string; name: string; series: { at: string; mastery: number }[] };
export type TimelineEvent = { at: string; kind: "sheet" | "revision"; label: string };

/** Okabe–Ito palette (colour-blind safe). Lines also differ by dash pattern when the palette wraps. */
export const LINE_COLORS = [
  "#E69F00",
  "#56B4E9",
  "#009E73",
  "#F0E442",
  "#0072B2",
  "#D55E00",
  "#CC79A7",
  "#999999",
] as const;
const DASHES = [undefined, "6 3", "2 3", "8 3 2 3"] as const;

export function lineStyle(index: number): { color: string; dash: string | undefined } {
  return {
    color: LINE_COLORS[index % LINE_COLORS.length],
    dash: DASHES[Math.floor(index / LINE_COLORS.length) % DASHES.length],
  };
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
