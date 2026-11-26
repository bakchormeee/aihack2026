import { MistakeTarget } from "@/components/mistake-focus";
import { SEVERITY_CLASS } from "@/components/mistake-list";
import type { Mistake } from "@/lib/domain";
import { boxStyle, padBox } from "@/lib/marking/boxes";
import { severityOf } from "@/lib/marking/rules";

/**
 * One photo of the student's working with a numbered box over each mistake the
 * marker placed on it. The browser draws the boxes over the image, so they scale
 * with the screen. Numbers match the list of mistakes.
 */
export function PhotoWithBoxes({
  src,
  fileIndex,
  mistakes,
  numbers,
}: {
  src: string;
  fileIndex: number;
  mistakes: Mistake[];
  /** The number of each mistake (see numberMistakes); default is its position in the list. */
  numbers?: (number | null)[];
}) {
  const boxed = mistakes.flatMap((mistake, index) => {
    const number = numbers ? numbers[index] : index + 1;
    return mistake.location.kind === "image" &&
      mistake.location.fileIndex === fileIndex &&
      number !== null
      ? [{ mistake, number, box: mistake.location.box }]
      : [];
  });

  return (
    <figure className="flex flex-col gap-1">
      <div className="relative w-full overflow-hidden rounded-lg border">
        {/* A signed link to a stored photo: next/image would add nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Your working, photo ${fileIndex + 1}`} className="block w-full" />
        {boxed.map(({ mistake, number, box }) => {
          const severity = severityOf(mistake.type);
          return (
            <MistakeTarget
              key={number}
              number={number}
              role="box"
              as="div"
              data-mistake={number}
              data-severity={severity}
              style={boxStyle(padBox(box))}
              className={`absolute rounded border-2 data-[active=true]:ring-foreground data-[active=true]:ring-2 ${SEVERITY_CLASS[severity].box}`}
            >
              <span
                className={`absolute -top-2.5 -left-2.5 flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${SEVERITY_CLASS[severity].badge}`}
              >
                {number}
              </span>
            </MistakeTarget>
          );
        })}
      </div>
      {boxed.length > 0 ? (
        <figcaption className="text-muted-foreground text-xs">
          Boxes are approximate: the exact words are in the list below.
        </figcaption>
      ) : null}
    </figure>
  );
}
