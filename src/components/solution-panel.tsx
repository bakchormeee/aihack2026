import { MathText } from "@/components/math-text";

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
      className="flex flex-col gap-2 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="solution-heading" className="text-base font-semibold">
          Worked solution
        </h2>
        <span className="text-muted-foreground text-xs">
          {solution.basis === "official"
            ? "Official solution"
            : "Written by the AI, not checked by your tutor"}
        </span>
      </div>
      <MathText className="text-sm">{solution.body}</MathText>
    </section>
  );
}
