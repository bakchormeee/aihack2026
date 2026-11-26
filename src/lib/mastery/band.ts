// Word labels for a topic's mastery (SPEC-study-views.md, `topic-list`). Mastery itself is
// computed as before (mastery.ts); only what is shown changes.

/** Below this a topic "needs work". */
export const NEEDS_WORK_BELOW = 0.45;
/** Above this (not equal to it) a topic is "solid". */
export const SOLID_ABOVE = 0.7;
/** Fewer marked long-form attempts than this and the topic is "too early to tell". */
export const MIN_ATTEMPTS_FOR_BAND = 3;

export type MasteryBandId = "too_early" | "needs_work" | "getting_there" | "solid";

export const BAND_LABEL: Record<MasteryBandId, string> = {
  too_early: "Too early to tell",
  needs_work: "Needs work",
  getting_there: "Getting there",
  solid: "Solid",
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The one quiet line under the topic list that explains the labels. */
export const BAND_LEGEND = [
  `${BAND_LABEL.needs_work}: below ${percent(NEEDS_WORK_BELOW)}`,
  `${BAND_LABEL.getting_there}: ${Math.round(NEEDS_WORK_BELOW * 100)}–${percent(SOLID_ABOVE)}`,
  `${BAND_LABEL.solid}: above ${percent(SOLID_ABOVE)}`,
  `${BAND_LABEL.too_early}: fewer than ${MIN_ATTEMPTS_FOR_BAND} marked attempts`,
].join(" · ");

/**
 * The label for a topic. `attempts` is the number of marked long-form attempts
 * (spot-the-error answers are not counted for the label).
 */
export function masteryBand(mastery: number | null, attempts: number): MasteryBandId {
  if (mastery === null || attempts < MIN_ATTEMPTS_FOR_BAND) return "too_early";
  if (mastery < NEEDS_WORK_BELOW) return "needs_work";
  if (mastery <= SOLID_ABOVE) return "getting_there";
  return "solid";
}

/** "Mastery 32% · 6 attempts": the tooltip text and the line in an open row. */
export function masteryLine(mastery: number | null, attempts: number): string {
  if (mastery === null) return "No marked attempts yet";
  return `Mastery ${percent(mastery)} · ${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
}

/** Weakest first: topics with marks by mastery (ties by name), then topics without marks by name. */
export function orderTopics<T extends { name: string; mastery: number | null }>(topics: T[]): T[] {
  return [...topics].sort((a, b) => {
    if (a.mastery === null && b.mastery === null) return a.name.localeCompare(b.name);
    if (a.mastery === null) return 1;
    if (b.mastery === null) return -1;
    return a.mastery - b.mastery || a.name.localeCompare(b.name);
  });
}
