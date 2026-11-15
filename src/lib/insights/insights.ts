// Pure helpers behind the "Focus next" panel. No database access here, so
// every rule is unit-tested.

const DAY = 24 * 60 * 60 * 1000;

export type TopicForFocus = {
  id: string;
  name: string;
  mastery: number | null;
  confidence: number;
  priority: number;
  attempts: number;
  series: { at: Date; mastery: number }[];
};

export type FocusItem = {
  id: string;
  name: string;
  mastery: number | null;
  attempts: number;
  daysSince: number | null;
  /** One short sentence on why this topic was picked. */
  reason: string;
};

function daysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The topics most worth practising next: the highest revision priority among
 * topics with marked work (weak, uncertain or going stale), then topics never
 * tried. Topics already secure (mastery ≥ 0.8 with good confidence) are left out.
 */
export function focusTopics(topics: TopicForFocus[], now: Date, limit = 3): FocusItem[] {
  const tried = topics
    .filter((t) => t.attempts > 0 && t.mastery !== null)
    .filter((t) => !(t.mastery! >= 0.8 && t.confidence >= 0.6))
    .sort((a, b) => b.priority - a.priority || a.mastery! - b.mastery!);
  const untried = topics
    .filter((t) => t.attempts === 0 || t.mastery === null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...tried, ...untried].slice(0, limit).map((t) => {
    const last = t.series.length ? t.series[t.series.length - 1].at : null;
    const daysSince = last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY)) : null;
    let reason: string;
    if (t.mastery === null || t.attempts === 0) {
      reason = "Not tried yet, so there is no evidence either way.";
    } else {
      const pct = Math.round(t.mastery * 100);
      const parts = [
        `${pct}% mastery from ${t.attempts} ${t.attempts === 1 ? "attempt" : "attempts"}`,
      ];
      if (daysSince !== null && daysSince >= 7) parts.push(`last practised ${daysAgo(daysSince)}`);
      else if (t.confidence < 0.4) parts.push("not much evidence yet");
      reason = parts.join(", ") + ".";
    }
    return { id: t.id, name: t.name, mastery: t.mastery, attempts: t.attempts, daysSince, reason };
  });
}
