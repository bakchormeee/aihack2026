import type { Outcome } from "@/lib/domain";

import { NEUTRAL_FILL, OUTCOME_STYLE } from "./colors";
import {
  describeCell,
  hintDotCount,
  shortLabel,
  summariseRow,
  type HeatCell,
} from "./heat-strip-model";

export type HeatStripProps = {
  rows: { sheetId: string; title: string; cells: HeatCell[] }[];
};

/** One row per sheet, one cell per question. Fill + symbol = outcome, dots = hint level. */
export function HeatStrip({ rows }: HeatStripProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No sheets yet.</p>;
  }

  return (
    <figure className="w-full min-w-0 space-y-3">
      <div className="space-y-4">
        {rows.map((row) => {
          const { attempted, total } = summariseRow(row.cells);
          return (
            <div key={row.sheetId} className="min-w-0">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium" title={row.title}>
                  {row.title}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {attempted}/{total} attempted
                </span>
              </div>
              {row.cells.length === 0 ? (
                <p className="text-xs text-muted-foreground">No questions.</p>
              ) : (
                <ul
                  className="flex gap-1.5 overflow-x-auto pb-1"
                  aria-label={`${row.title}: questions`}
                >
                  {row.cells.map((cell, i) => {
                    const style = cell.outcome ? OUTCOME_STYLE[cell.outcome] : null;
                    const dots = hintDotCount(cell);
                    return (
                      <li
                        key={i}
                        className="flex shrink-0 flex-col items-center gap-0.5"
                        aria-label={describeCell(cell)}
                        title={describeCell(cell)}
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-9 items-center justify-center rounded-md border text-sm font-bold text-black"
                          style={
                            style
                              ? { backgroundColor: style.fill, borderColor: style.fill }
                              : {
                                  backgroundColor: "transparent",
                                  borderColor: NEUTRAL_FILL,
                                  borderStyle: "dashed",
                                }
                          }
                        >
                          {style ? style.symbol : <span className="text-muted-foreground">–</span>}
                        </span>
                        <span
                          aria-hidden="true"
                          className="text-[10px] leading-none text-muted-foreground"
                        >
                          {shortLabel(cell.label)}
                        </span>
                        <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                          {Array.from({ length: dots }, (_, d) => (
                            <span key={d} className="size-1.5 rounded-full bg-foreground" />
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(OUTCOME_STYLE) as Outcome[]).map((o) => (
          <span key={o} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center rounded-sm text-[10px] font-bold text-black"
              style={{ backgroundColor: OUTCOME_STYLE[o].fill }}
            >
              {OUTCOME_STYLE[o].symbol}
            </span>
            {OUTCOME_STYLE[o].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-4 rounded-sm border border-dashed"
            style={{ borderColor: NEUTRAL_FILL }}
          />
          Not attempted
        </span>
        <span>Dots under a cell = hint level (0–3)</span>
      </figcaption>
    </figure>
  );
}
