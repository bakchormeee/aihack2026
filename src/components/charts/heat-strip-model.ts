import type { HintLevel, Outcome } from "@/lib/domain";

import { OUTCOME_STYLE } from "./colors";

export type HeatCell = {
  label: string;
  outcome: Outcome | null;
  hintLevel: HintLevel;
  /** When set, the cell links to the question so a student can go straight back to it. */
  questionId?: string;
};

/** Text for screen readers and tooltips, e.g. "Q3: Partly right, 2 hints". */
export function describeCell(cell: HeatCell): string {
  if (cell.outcome === null) return `${cell.label}: not attempted`;
  const hints =
    cell.hintLevel === 0 ? "no hints" : cell.hintLevel === 1 ? "1 hint" : `${cell.hintLevel} hints`;
  return `${cell.label}: ${OUTCOME_STYLE[cell.outcome].label}, ${hints}`;
}

/** Dots shown under a cell: only attempted cells get dots; the count is the hint level. */
export function hintDotCount(cell: HeatCell): number {
  return cell.outcome === null ? 0 : Math.min(3, Math.max(0, cell.hintLevel));
}

/** Short cell caption: keeps "Q12" style labels whole and clips long ones. */
export function shortLabel(label: string, max = 4): string {
  const chars = Array.from(label.trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("");
}

export function summariseRow(cells: HeatCell[]): { attempted: number; total: number } {
  return { attempted: cells.filter((c) => c.outcome !== null).length, total: cells.length };
}
