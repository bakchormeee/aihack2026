import type { Outcome } from "@/lib/domain";

/** Viridis stops: one sequential, colour-blind-safe scale for mastery (low = dark purple, high = yellow). */
const MASTERY_STOPS = ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"] as const;

/** Neutral grey for "no mastery yet"; reads on light and dark backgrounds. */
export const NEUTRAL_FILL = "#8a8f98";

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

/** Okabe–Ito based outcome fills. Each outcome also has a distinct symbol so colour is never the only cue. */
export const OUTCOME_STYLE: Record<Outcome, { fill: string; symbol: string; label: string }> = {
  full: { fill: "#56B4E9", symbol: "✓", label: "Full" },
  partial: { fill: "#E69F00", symbol: "~", label: "Partial" },
  stuck: { fill: "#D55E00", symbol: "✕", label: "Stuck" },
};
