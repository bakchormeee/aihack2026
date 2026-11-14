import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import type { Outcome, SpotJudgement, SpotTick } from "@/lib/domain";
import { OUTCOME_LABEL } from "@/lib/marking/labels";

type Planted = {
  line: number;
  whatsWrong: string;
  correctLine: string;
  /** The student's own common error this was based on. */
  misconception: string;
};

const OUTCOME_VARIANT: Record<Outcome, "default" | "secondary" | "destructive"> = {
  full: "default",
  partial: "secondary",
  stuck: "destructive",
};

/** After answering: every planted error with its correction and source, and what the student ticked. */
export function SpotReveal({
  lines,
  planted,
  ticked,
  judgements,
  noError,
  outcome,
}: {
  lines: string[];
  planted: Planted[];
  ticked: SpotTick[];
  judgements: SpotJudgement[];
  noError: boolean;
  outcome: Outcome;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={OUTCOME_VARIANT[outcome]}>{OUTCOME_LABEL[outcome]}</Badge>
        {planted.length === 0 ? (
          <span className="text-sm">This solution had no error.</span>
        ) : noError ? (
          <span className="text-sm">You said there was no error, but there was.</span>
        ) : null}
      </div>

      <ol className="flex flex-col gap-2">
        {lines.map((text, index) => {
          const line = index + 1;
          const error = planted.find((p) => p.line === line);
          const tick = ticked.find((t) => t.line === line);
          const verdict = judgements.find((j) => j.line === line);
          return (
            <li
              key={line}
              data-line={line}
              data-planted={error ? "true" : undefined}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${error ? "border-red-600 bg-red-500/10" : tick ? "border-amber-500 bg-amber-400/10" : ""}`}
            >
              <div className="flex items-start gap-3">
                <span className="text-muted-foreground mt-0.5 w-5 shrink-0 text-sm">{line}.</span>
                <MathText className="min-w-0 text-sm">{text}</MathText>
              </div>
              {error ? (
                <div className="flex flex-col gap-1 pl-8 text-sm">
                  <p className="text-xs font-semibold text-red-700 uppercase dark:text-red-400">
                    {tick ? "You found this" : "You did not tick this line"}
                  </p>
                  <MathText className="text-sm">{error.whatsWrong}</MathText>
                  <p className="text-muted-foreground text-xs font-medium">Correct line</p>
                  <MathText className="text-sm">{error.correctLine}</MathText>
                  <p className="text-muted-foreground text-xs">
                    Based on your common error:{" "}
                    <MathText className="inline [&_p]:inline">{error.misconception}</MathText>
                  </p>
                  {tick ? (
                    <div className="mt-1 flex flex-col gap-1 rounded-md border p-2">
                      <p className="text-xs font-medium">Your explanation</p>
                      <MathText className="text-sm">{tick.explanation}</MathText>
                      {verdict ? (
                        <p className="text-xs font-medium">
                          {verdict.right ? "Right: " : "Your explanation did not match: "}
                          <MathText className="inline text-xs [&_p]:inline">
                            {verdict.comment}
                          </MathText>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : tick ? (
                <p className="pl-8 text-xs font-semibold text-amber-700 uppercase dark:text-amber-400">
                  This line was correct
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
