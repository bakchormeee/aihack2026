import { MathText } from "@/components/math-text";
import { MistakeTarget } from "@/components/mistake-focus";
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
  if (location.kind === "pdf") return `Page ${location.page}`;
  if (location.kind === "image") return `Photo ${location.fileIndex + 1}`;
  return null;
}

/**
 * The notes under the working. `numbers` says which mistake has which number on the working (see
 * numberMistakes); a mistake with no place is listed without a number. By default every mistake
 * is numbered by its position.
 */
export function MistakeList({
  mistakes,
  numbers,
}: {
  mistakes: Mistake[];
  numbers?: (number | null)[];
}) {
  if (mistakes.length === 0) return null;
  return (
    <ol className="flex list-none flex-col gap-3">
      {mistakes.map((mistake, index) => {
        const severity = severityOf(mistake.type);
        const place = where(mistake);
        const number = numbers ? numbers[index] : index + 1;
        return (
          <MistakeTarget
            key={index}
            number={number}
            role="note"
            as="li"
            data-note={number ?? undefined}
            className={`flex gap-3 rounded-lg border-l-4 border p-3 data-[active=true]:ring-foreground data-[active=true]:ring-2 ${SEVERITY_CLASS[severity].box}`}
          >
            {number === null ? (
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center text-xs"
              >
                –
              </span>
            ) : (
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${SEVERITY_CLASS[severity].badge}`}
              >
                {number}
              </span>
            )}
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <p className="text-xs font-medium">
                {SEVERITY_LABEL[severity]} · {ERROR_LABEL[mistake.type]}
                {place ? ` · ${place}` : ""}
              </p>
              <MathText className="text-sm">{mistake.quote}</MathText>
              <MathText className="text-sm">{mistake.hint}</MathText>
            </div>
          </MistakeTarget>
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
