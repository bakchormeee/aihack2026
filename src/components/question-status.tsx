import { OUTCOME_STYLE } from "@/components/charts/colors";
import type { QuestionStatus } from "@/lib/scores/status";

const PILL = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium";

/**
 * The status on the right of a question row (SPEC-study-views.md, question-marks). Always
 * text; the pips are decorative. A question that was not started shows nothing.
 */
export function QuestionStatusView({ status }: { status: QuestionStatus }) {
  switch (status.kind) {
    case "none":
      return null;
    case "draft":
      return <span className={`${PILL} text-muted-foreground`}>Draft</span>;
    case "marking":
      return <span className={`${PILL} text-muted-foreground`}>Marking…</span>;
    case "waiting":
      return <span className={`${PILL} text-muted-foreground`}>Waiting for official solution</span>;
    case "failed":
      return (
        <span className={`${PILL} border-destructive/40 text-destructive`}>Marking failed</span>
      );
    case "marked":
      return (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <div className="flex items-center gap-2">
            <span className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className="h-1.5 w-4 rounded-full"
                  style={{
                    backgroundColor:
                      n <= status.score ? OUTCOME_STYLE[status.outcome].fill : "var(--muted)",
                  }}
                />
              ))}
            </span>
            <span className="text-sm font-medium tabular-nums">{status.score} / 5</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {status.outcomeLabel}
            {status.attempts > 1 ? ` · ${status.attempts} attempts` : ""}
          </span>
        </div>
      );
  }
}
