import { MathText } from "@/components/math-text";
import { SEVERITY_CLASS } from "@/components/mistake-list";
import type { Mistake } from "@/lib/domain";
import { locateQuotes, splitByRanges } from "@/lib/marking/locate-quotes";
import { severityOf } from "@/lib/marking/rules";

// Markdown joins lines, so each line is rendered on its own to keep the student's line breaks.
function Lines({ children }: { children: string }) {
  return children.split("\n").map((line, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      {line.trim() ? <MathText className="inline [&_p]:inline">{line}</MathText> : null}
    </span>
  ));
}

/**
 * The student's typed working with a numbered box round each mistake the marker
 * quoted. Numbers match the list under it. A quote that cannot be found in the
 * text is left out here and stays in the list only.
 */
export function WorkingWithBoxes({ text, mistakes }: { text: string; mistakes: Mistake[] }) {
  // Positions in `mistakes` are kept, so the numbers agree with the list even when
  // some mistakes are in a photo or a PDF and have no box here.
  const ranges = locateQuotes(
    text,
    mistakes.map((m) => (m.location.kind === "text" ? m.quote : "")),
  );
  const pieces = splitByRanges(text, ranges);

  return (
    <div className="text-sm leading-8">
      {pieces.map((piece, i) => {
        if (piece.box === null) {
          return <Lines key={i}>{piece.text}</Lines>;
        }
        const severity = severityOf(mistakes[piece.box].type);
        return (
          <span
            key={i}
            data-mistake={piece.box + 1}
            data-severity={severity}
            className={`ring-once rounded border-2 px-1 py-1.5 [box-decoration-break:clone] ${SEVERITY_CLASS[severity].box}`}
            style={{ "--delay": `${600 + piece.box * 250}ms` } as React.CSSProperties}
          >
            <sup
              className={`mr-1 rounded px-1 text-[10px] font-semibold ${SEVERITY_CLASS[severity].badge}`}
            >
              {piece.box + 1}
            </sup>
            <Lines>{piece.text}</Lines>
          </span>
        );
      })}
    </div>
  );
}
