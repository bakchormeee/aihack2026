import { MathText } from "@/components/math-text";
import { solutionLabel } from "@/lib/marking/labels";

/**
 * The worked solution. Render it only with a value from getVisibleSolution(),
 * which is null while the solution is locked: this component never decides.
 */
export function SolutionPanel({
  solution,
}: {
  solution: { basis: "ai" | "official"; body: string };
}) {
  return (
    <section
      aria-labelledby="solution-heading"
      className="bg-card border-foreground/80 flex flex-col gap-3 rounded-lg border border-t-2 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="solution-heading" className="text-lg font-medium">
          Worked solution
        </h2>
        <span className="text-muted-foreground text-xs">{solutionLabel(solution.basis)}</span>
      </div>
      <MathText>{solution.body}</MathText>
    </section>
  );
}
