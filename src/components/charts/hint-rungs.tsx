import { cn } from "@/lib/utils";
import type { HintLevel } from "@/lib/domain";

import { HINT_LEVEL_FILLS, HINT_LEVEL_INK, rungStates, rungsLabel } from "./hint-ladder";

/** Three rungs that fill as hints are revealed. Filled rungs carry a number; empty ones are outlined. */
export function HintRungs({ revealed }: { revealed: HintLevel }) {
  const states = rungStates(revealed);
  return (
    <div role="img" aria-label={rungsLabel(revealed)} className="flex items-center gap-2">
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        {states.map((filled, i) => (
          <li
            key={i}
            className={cn(
              "flex size-7 items-center justify-center rounded-md border-2 text-xs font-semibold",
              filled ? "" : "border-dashed text-muted-foreground",
            )}
            style={
              filled
                ? {
                    backgroundColor: HINT_LEVEL_FILLS[i + 1],
                    borderColor: HINT_LEVEL_FILLS[i + 1],
                    color: HINT_LEVEL_INK[i + 1],
                  }
                : undefined
            }
          >
            {filled ? i + 1 : "–"}
          </li>
        ))}
      </ol>
      <span className="text-sm text-muted-foreground">{rungsLabel(revealed)}</span>
    </div>
  );
}
