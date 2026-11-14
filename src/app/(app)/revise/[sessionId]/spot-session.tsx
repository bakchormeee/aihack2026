import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getSpotSession } from "@/db/queries/spot";
import { OUTCOME_LABEL } from "@/lib/marking/labels";
import { isStale } from "@/lib/pipeline/stale";

import { retryRevisionAction } from "../actions";

/** A spot-the-error session: its questions, how each went, and a summary once all are answered. */
export async function SpotSessionView({
  userId,
  sessionId,
}: {
  userId: string;
  sessionId: string;
}) {
  const { session, items, done, counts, missed } = await getSpotSession(userId, sessionId);
  const stuck = session.status === "building" && isStale(session.statusUpdatedAt);
  const building = session.status === "building" && !stuck;
  const next = items.find((item) => !item.answered);
  const answered = items.filter((item) => item.answered).length;
  const wanted = session.questionCount ?? items.length;

  return (
    <section className="flex flex-col gap-4">
      <AutoRefresh active={building} />
      <div>
        <Link
          href={`/courses/${session.courseId}`}
          className="text-muted-foreground text-sm underline"
        >
          Course
        </Link>
        <h1 className="text-xl font-semibold">Spot the error, {wanted} questions</h1>
      </div>

      {building ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground text-sm">
            Writing solutions with your own common errors in them. This takes a minute.
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {session.status === "failed" || stuck ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">
            {stuck ? "Building this session is taking too long." : "Building this session failed."}
          </p>
          <form action={retryRevisionAction.bind(null, session.id)}>
            <Button type="submit">Try again</Button>
          </form>
        </div>
      ) : null}

      {session.status === "ready" ? (
        <>
          {items.length < wanted ? (
            <p role="status" className="text-muted-foreground text-sm">
              Only {items.length} of {wanted} questions could be written this time.
            </p>
          ) : null}
          <p className="text-muted-foreground text-sm">
            {answered} of {items.length} answered.
          </p>
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.position}>
                <Link
                  href={`/revise/${session.id}/spot/${item.position}`}
                  className="hover:bg-muted flex items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="font-medium">Question {item.position}</span>
                  {item.outcome ? (
                    <Badge variant="secondary">{OUTCOME_LABEL[item.outcome]}</Badge>
                  ) : (
                    <Badge variant="outline">{item.answered ? "Checking…" : "To do"}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ol>

          {next ? (
            <Link
              href={`/revise/${session.id}/spot/${next.position}`}
              className={buttonVariants({ className: "self-start" })}
            >
              {answered === 0 ? "Start" : "Continue"}
            </Link>
          ) : null}

          {done ? (
            <div className="flex flex-col gap-3 rounded-lg border p-4" aria-label="Summary">
              <h2 className="text-base font-semibold">Summary</h2>
              <p className="text-sm">
                {counts.full} correct, {counts.partial} partly right, {counts.stuck} stuck.
              </p>
              {missed.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Common errors you missed this time</p>
                  <ul className="flex flex-col gap-2">
                    {missed.map((description) => (
                      <li key={description} className="text-sm">
                        <MathText>{description}</MathText>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm">You found every error. Well done.</p>
              )}
              <Link
                href={`/revise?course=${session.courseId}&mode=spot_error`}
                className={buttonVariants({ variant: "outline", className: "self-start" })}
              >
                Practise again
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
