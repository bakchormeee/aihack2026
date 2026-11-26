import type { ReactNode } from "react";

import { MathText } from "@/components/math-text";
import { solutionLabel } from "@/lib/marking/labels";

/**
 * The official solution next to the student's submitted working. `solution`
 * must come from getVisibleSolution(); null shows that none is available.
 */
export function SideBySide({
  solution,
  text,
  files,
}: {
  solution: { basis: "ai" | "official"; body: string } | null;
  text: string | null;
  files: { id: string; mime: string }[];
}): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-2 bg-card rounded-lg border p-5">
        <h3 className="text-sm font-semibold">
          {solution ? solutionLabel(solution.basis) : "Worked solution"}
        </h3>
        {solution ? (
          <MathText className="text-sm">{solution.body}</MathText>
        ) : (
          <p className="text-muted-foreground text-sm">
            The official solutions do not cover this question.
          </p>
        )}
      </section>
      <section className="flex min-w-0 flex-col gap-2 bg-card rounded-lg border p-5">
        <h3 className="text-sm font-semibold">Your working</h3>
        {text?.trim() ? <MathText className="text-sm">{text}</MathText> : null}
        {files.map((file, index) =>
          file.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed redirect, not a static asset
            <img
              key={file.id}
              src={`/api/files/submission/${file.id}`}
              alt={`Page ${index + 1} of your working`}
              className="max-h-96 rounded border object-contain"
            />
          ) : (
            <a
              key={file.id}
              href={`/api/files/submission/${file.id}`}
              className="text-sm underline"
            >
              Open file {index + 1}
            </a>
          ),
        )}
        {!text?.trim() && files.length === 0 ? (
          <p className="text-muted-foreground text-sm">No working was submitted.</p>
        ) : null}
      </section>
    </div>
  );
}
