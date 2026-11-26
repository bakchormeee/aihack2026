import { scoreLine, type SheetScore } from "@/lib/scores/score";

/**
 * One line under a sheet's title, above its tabs: the score on the questions attempted and
 * how many that is (SPEC-study-views.md, attempted-score).
 */
export function SheetScoreLine({ score }: { score: SheetScore }) {
  if (score.total === 0) return null;
  const { big, detail } = scoreLine(score);
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="sheet-score-line">
      {big ? <span className="font-heading text-3xl tabular-nums">{big}</span> : null}
      <span className="text-muted-foreground text-sm">{detail}</span>
    </p>
  );
}
