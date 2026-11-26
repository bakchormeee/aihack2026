import type { ErrorType, Outcome, Severity } from "@/lib/domain";
import { OUTCOME_LABEL } from "@/lib/marking/labels";

/*
 * One chart palette for the whole app, checked with the dataviz validator
 * against the paper card surface (#fffefb):
 *
 * - Mastery is DIVERGING around 50%: red pen for "needs work", a warm neutral
 *   at the midpoint, blue ink for "secure". Both arms step through the same
 *   OKLCH lightness (0.48 / 0.62 / 0.76), so neither side looks heavier, and
 *   weak topics stand out instead of fading into the paper.
 * - Outcomes and mistake severity are STATUS colours (good / warning /
 *   critical): reserved meaning, always shown with a symbol and a word.
 * - Topic lines use the 8-slot CATEGORICAL order (adjacent CVD ΔE ≥ 9.1).
 *   Slots 3, 4 and 5 sit below 3:1 on paper, so every chart that uses them
 *   ships direct labels or a table view.
 */

/** Mastery stops from 0 (needs work) through 0.5 (neutral) to 1 (secure). */
const MASTERY_STOPS = [
  "#a32c2c",
  "#dd504d",
  "#ef9790",
  "#d9d5cc",
  "#86b6ef",
  "#3987e5",
  "#1c5cab",
] as const;

/** Mid grey for "no mastery yet": darker than the neutral midpoint so the two never meet. */
export const NEUTRAL_FILL = "#8a8781";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** Fill colour for a mastery value in [0, 1]; null (or NaN) gives neutral grey. Out-of-range values are clamped. */
export function masteryColor(mastery: number | null): string {
  if (mastery === null || Number.isNaN(mastery)) return NEUTRAL_FILL;
  const t = Math.min(1, Math.max(0, mastery)) * (MASTERY_STOPS.length - 1);
  const i = Math.min(MASTERY_STOPS.length - 2, Math.floor(t));
  const f = t - i;
  const a = hexToRgb(MASTERY_STOPS[i]);
  const b = hexToRgb(MASTERY_STOPS[i + 1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** Black or white, whichever reads better on the given hex fill. */
export function textColorOn(hex: string): "#000000" | "#ffffff" {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export const MASTERY_GRADIENT = `linear-gradient(to right, ${MASTERY_STOPS.join(", ")})`;

/** Status colours (fixed, never themed). */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

/** Outcome fills. Each outcome also has its own symbol and label, so colour is never the only cue. */
export const OUTCOME_STYLE: Record<
  Outcome,
  { fill: string; ink: "#000000" | "#ffffff"; symbol: string; label: string }
> = {
  full: { fill: STATUS.good, ink: "#ffffff", symbol: "✓", label: OUTCOME_LABEL.full },
  partial: { fill: STATUS.warning, ink: "#000000", symbol: "~", label: OUTCOME_LABEL.partial },
  stuck: { fill: STATUS.critical, ink: "#ffffff", symbol: "✕", label: OUTCOME_LABEL.stuck },
};

/** Careless slips are amber, structural mistakes red pen: the same split as the boxes on the mark screen. */
export const SEVERITY_FILL: Record<Severity, string> = {
  careless: STATUS.warning,
  structural: STATUS.critical,
};

/** Fixed order in which error types are listed: structural first (they cost more), then careless. */
export const ERROR_TYPE_ORDER: readonly ErrorType[] = [
  "conceptual",
  "method",
  "incomplete",
  "misread_question",
  "algebra_slip",
  "arithmetic_slip",
  "notation",
];
