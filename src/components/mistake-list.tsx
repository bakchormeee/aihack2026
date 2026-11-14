import { MathText } from "@/components/math-text";
import type { Mistake, Severity } from "@/lib/domain";
import { ERROR_LABEL, MARKING_SCHEME, SEVERITY_LABEL } from "@/lib/marking/labels";
import { severityOf } from "@/lib/marking/rules";

/** Red for a structural mistake, amber for a careless slip. Shared by every box and badge. */
export const SEVERITY_CLASS: Record<Severity, { box: string; badge: string }> = {
  structural: {
    box: "border-red-600 bg-red-500/15",
    badge: "bg-red-600 text-white",
  },
  careless: {
    box: "border-amber-500 bg-amber-400/20",
    badge: "bg-amber-500 text-black",
  },
};

function where(mistake: Mistake): string | null {
  const { location } = mistake;
  if (location.kind === "pdf") return `PDF, page ${location.page}`;
  if (location.kind === "image") return `Photo ${location.fileIndex + 1}`;
  return null;
}

export function MistakeList({ mistakes }: { mistakes: Mistake[] }) {
  if (mistakes.length === 0) return null;
  return (
    <ol className="flex flex-col gap-3">
      {mistakes.map((mistake, index) => {
        const severity = severityOf(mistake.type);
        const place = where(mistake);
        return (
          <li
            key={index}
            className={`flex gap-3 rounded-lg border-l-4 border p-3 ${SEVERITY_CLASS[severity].box}`}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${SEVERITY_CLASS[severity].badge}`}
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="text-xs font-medium uppercase">
                {SEVERITY_LABEL[severity]} · {ERROR_LABEL[mistake.type]}
                {place ? ` · ${place}` : ""}
              </p>
              <MathText className="text-sm">{mistake.quote}</MathText>
              <MathText className="text-sm">{mistake.hint}</MathText>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function MarkingScheme({ score }: { score: number }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {MARKING_SCHEME.map((row) => (
        <li
          key={row.score}
          aria-current={row.score === score ? "true" : undefined}
          className={`flex gap-3 rounded-md px-2 py-1 ${row.score === score ? "bg-muted font-semibold" : "text-muted-foreground"}`}
        >
          <span className="w-4 shrink-0">{row.score}</span>
          <span>{row.meaning}</span>
        </li>
      ))}
    </ul>
  );
}
