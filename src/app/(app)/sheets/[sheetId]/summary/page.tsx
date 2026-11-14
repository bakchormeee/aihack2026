import { AutoRefresh } from "@/components/auto-refresh";
import { HintLadderBar } from "@/components/charts/hint-ladder-bar";
import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

import { retrySummaryAction } from "./actions";
import { startSummaryIfNeeded } from "./generate";

// The summary is written in the background after the page renders.
export const maxDuration = 300;

export default async function SummaryPage({ params }: PageProps<"/sheets/[sheetId]/summary">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const sheet = await orNotFound(requireSheet(user.id, sheetId));
  const state = await startSummaryIfNeeded(user.id, sheetId);

  return (
    <section className="flex flex-col gap-4">
      <AutoRefresh active={state.kind === "generating"} />
      <h1>{sheet.title}: summary</h1>

      {state.kind === "waiting" ? (
        <p className="text-muted-foreground text-sm">
          {state.total === 0
            ? "This sheet has no questions yet."
            : `The summary is available once every question has a marked attempt. ${state.remaining} of ${state.total} ${state.remaining === 1 ? "question remains" : "questions remain"}.`}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2 bg-card rounded-lg border p-5">
            <h2 className="font-medium">Questions solved, by hints used</h2>
            <HintLadderBar counts={state.ladder} />
          </div>

          {state.kind === "generating" ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="text-muted-foreground text-sm">Preparing the summary…</p>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}

          {state.kind === "failed" ? (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 bg-card rounded-lg border p-5"
            >
              <p className="text-sm">The summary could not be prepared.</p>
              <form action={retrySummaryAction.bind(null, sheetId)}>
                <Button type="submit" variant="outline" size="sm">
                  Try again
                </Button>
              </form>
            </div>
          ) : null}

          {state.kind === "ready" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Points title="What went well" points={state.body.wentWell} />
              <Points title="What was hard" points={state.body.wasHard} />
              <Points title="Next steps" points={state.body.nextSteps} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Points({ title, points }: { title: string; points: string[] }) {
  return (
    <div className="flex flex-col gap-2 bg-card rounded-lg border p-5">
      <h2 className="font-medium">{title}</h2>
      {points.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing to report.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {points.map((point, index) => (
            <li key={index}>
              <MathText>{point}</MathText>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
