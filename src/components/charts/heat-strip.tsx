import Link from "next/link";

import type { Outcome } from "@/lib/domain";

import { NEUTRAL_FILL, OUTCOME_STYLE } from "./colors";
import { HINT_LEVEL_FILLS } from "./hint-ladder";
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

const CELL =
  "relative flex size-9 items-center justify-center rounded-md border text-sm font-bold transition-transform duration-150 group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5";

/** The square for one question: fill + symbol = outcome; dashed outline = not attempted. */
function CellSquare({ cell }: { cell: HeatCell }) {
  const style = cell.outcome ? OUTCOME_STYLE[cell.outcome] : null;
  return (
    <span
      aria-hidden="true"
      className={CELL}
      style={
        style
          ? { backgroundColor: style.fill, borderColor: style.fill, color: style.ink }
          : { backgroundColor: "transparent", borderColor: NEUTRAL_FILL, borderStyle: "dashed" }
      }
    >
      {style ? style.symbol : <span className="text-muted-foreground">–</span>}
    </span>
  );
}

/** A tooltip that appears on hover and keyboard focus; the same words are the cell's accessible name. */
function CellTip({ cell }: { cell: HeatCell }) {
  const style = cell.outcome ? OUTCOME_STYLE[cell.outcome] : null;
  const hints =
    cell.hintLevel === 0
      ? "No hints"
      : `${cell.hintLevel} ${cell.hintLevel === 1 ? "hint" : "hints"}`;
  return (
    <span
      role="presentation"
      className="bg-popover text-popover-foreground pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-48 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-left text-xs shadow-md group-hover:block group-focus-visible:block"
    >
      <span className="block font-semibold">{cell.label}</span>
      {style ? (
        <>
          <span className="block">{style.label}</span>
          <span className="text-muted-foreground block">{hints}</span>
        </>
      ) : (
        <span className="text-muted-foreground block">Not attempted yet</span>
      )}
      {cell.questionId ? (
        <span className="text-muted-foreground mt-1 block border-t pt-1">
          {cell.outcome === "full"
            ? "Open question"
            : cell.outcome
              ? "Have another go"
              : "Start it"}{" "}
          →
        </span>
      ) : null}
    </span>
  );
}

/** One row per sheet, one cell per question. Fill + symbol = outcome, dots = hint level. Cells link to their question. */
export function HeatStrip({ rows }: HeatStripProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No sheets yet.</p>;
  }

  return (
    <figure className="w-full min-w-0 space-y-4">
      <div className="space-y-5">
        {rows.map((row) => {
          const { attempted, total } = summariseRow(row.cells);
          const correct = row.cells.filter((c) => c.outcome === "full").length;
          return (
            <div key={row.sheetId} className="min-w-0">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium" title={row.title}>
                  {row.title}
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {correct}/{total} correct · {attempted}/{total} attempted
                </span>
              </div>
              {row.cells.length === 0 ? (
                <p className="text-xs text-muted-foreground">No questions.</p>
              ) : (
                // The row scrolls sideways, which would clip the tooltip, so the list reaches up
                // over the heading (padding the same as the negative margin) and lets clicks
                // through that padding.
                <ul
                  className="pointer-events-none -mt-20 flex gap-1.5 overflow-x-auto px-0.5 pt-20 pb-1"
                  aria-label={`${row.title}: questions`}
                >
                  {row.cells.map((cell, i) => {
                    const dots = hintDotCount(cell);
                    const body = (
                      <>
                        <CellSquare cell={cell} />
                        <span
                          aria-hidden="true"
                          className="text-[10px] leading-none text-muted-foreground"
                        >
                          {shortLabel(cell.label)}
                        </span>
                        <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                          {Array.from({ length: dots }, (_, d) => (
                            <span
                              key={d}
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: HINT_LEVEL_FILLS[3] }}
                            />
                          ))}
                        </span>
                        <CellTip cell={cell} />
                      </>
                    );
                    const cls =
                      "group relative flex shrink-0 flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring";
                    return (
                      <li key={i} className="pointer-events-auto shrink-0">
                        {cell.questionId ? (
                          <Link
                            href={`/questions/${cell.questionId}`}
                            className={cls}
                            aria-label={describeCell(cell)}
                          >
                            {body}
                          </Link>
                        ) : (
                          <span tabIndex={0} className={cls} aria-label={describeCell(cell)}>
                            {body}
                          </span>
                        )}
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
              className="flex size-4 items-center justify-center rounded-sm text-[10px] font-bold"
              style={{ backgroundColor: OUTCOME_STYLE[o].fill, color: OUTCOME_STYLE[o].ink }}
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
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="flex gap-0.5">
            {[0, 1].map((d) => (
              <span
                key={d}
                className="size-1.5 rounded-full"
                style={{ backgroundColor: HINT_LEVEL_FILLS[3] }}
              />
            ))}
          </span>
          Hints used (one dot each)
        </span>
        <span>Select a square to open the question</span>
      </figcaption>
    </figure>
  );
}
