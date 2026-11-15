import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { PlaySound } from "@/components/play-sound";
import {
  Meter,
  PageHeader,
  Panel,
  RULED_ROW_LINK,
  RuledList,
  SectionTitle,
} from "@/components/page-parts";
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
    <section className="flex flex-col gap-6">
      <AutoRefresh active={building} />
      <PageHeader
        back={{ href: `/courses/${session.courseId}`, label: "Course" }}
        title={`Spot the error, ${wanted} questions`}
        description="Each solution was written with your own common errors planted in it. Find them."
      />

      {building ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <span className="bg-pen size-2 animate-pulse rounded-full" aria-hidden="true" />
            Writing solutions with your own common errors in them. This takes a minute.
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {session.status === "failed" || stuck ? (
        <Panel role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">
            {stuck ? "Building this session is taking too long." : "Building this session failed."}
          </p>
          <form action={retryRevisionAction.bind(null, session.id)}>
            <Button type="submit">Try again</Button>
          </form>
        </Panel>
      ) : null}

      {session.status === "ready" ? (
        <>
          {items.length < wanted ? (
            <p role="status" className="text-muted-foreground text-sm">
              Only {items.length} of {wanted} questions could be written this time.
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              {answered} of {items.length} answered.
            </p>
            <Meter value={items.length ? answered / items.length : 0} label="Questions answered" />
          </div>
          <RuledList className="rise-children">
            {items.map((item) => (
              <li key={item.position}>
                <Link
                  href={`/revise/${session.id}/spot/${item.position}`}
                  className={`${RULED_ROW_LINK} flex-row items-center justify-between`}
                >
                  <span className="font-heading text-lg font-medium">Question {item.position}</span>
                  {item.outcome ? (
                    <Badge variant={item.outcome === "full" ? "default" : "secondary"}>
                      {OUTCOME_LABEL[item.outcome]}
                    </Badge>
                  ) : (
                    <Badge variant="outline">{item.answered ? "Checking…" : "To do"}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </RuledList>

          {next ? (
            <Link
              href={`/revise/${session.id}/spot/${next.position}`}
              className={buttonVariants({ className: "self-start" })}
            >
              {answered === 0 ? "Start" : "Continue"}
            </Link>
          ) : null}

          {done ? (
            <Panel
              className="border-foreground/80 rise flex flex-col gap-4 border-t-2"
              aria-label="Summary"
            >
              <SectionTitle>Summary</SectionTitle>
              <PlaySound
                sound={counts.full === items.length ? "fanfare" : "partial"}
                once={`spot-summary:${sessionId}`}
              />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <span className="font-heading text-pen stamp rounded-full border-[3px] border-current px-4 py-2 text-4xl leading-none italic tabular-nums">
                  {counts.full}/{items.length}
                </span>
                <p className="text-sm">
                  {counts.full} correct, {counts.partial} partly right, {counts.stuck} stuck.
                </p>
              </div>
              {missed.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Common errors you missed this time</p>
                  <ul className="flex flex-col gap-2">
                    {missed.map((description) => (
                      <li key={description} className="border-l-pen border-l-2 pl-3 text-sm">
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
            </Panel>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
