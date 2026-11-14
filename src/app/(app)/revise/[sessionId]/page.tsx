import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
import { PageHeader, Panel, RULED_ROW_LINK, RuledList } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getRevisionSession } from "@/db/queries/revision";
import { orNotFound } from "@/lib/auth/guards";
import { requireUser } from "@/lib/auth/session";
import { isStale } from "@/lib/pipeline/stale";

import { retryRevisionAction } from "../actions";

// The retry button builds the session again after the response, which can take minutes.
export const maxDuration = 300;

export default async function RevisionSessionPage({ params }: PageProps<"/revise/[sessionId]">) {
  const user = await requireUser();
  const { sessionId } = await params;
  const { session, items } = await orNotFound(getRevisionSession(user.id, sessionId));

  const stuck = session.status === "building" && isStale(session.statusUpdatedAt);
  const building = session.status === "building" && !stuck;
  const next = items.find((item) => !item.done);
  const doneCount = items.filter((item) => item.done).length;

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={building} />
      <PageHeader
        back={{ href: `/courses/${session.courseId}`, label: "Course" }}
        title={`Revision session, ${session.targetMinutes} minutes`}
      />

      {building ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground">
            Choosing questions and writing fresh variants. This takes a minute.
          </p>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : null}

      {session.status === "failed" || stuck ? (
        <Panel role="alert" className="flex flex-col items-start gap-3">
          <p>
            {stuck ? "Building this session is taking too long." : "Building this session failed."}
          </p>
          <form action={retryRevisionAction.bind(null, session.id)}>
            <Button type="submit">Try again</Button>
          </form>
        </Panel>
      ) : null}

      {session.status === "ready" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground tabular-nums">
              {doneCount} of {items.length} done.
            </p>
            {next ? (
              <Link
                href={`/questions/${next.questionId}?session=${session.id}`}
                className={buttonVariants()}
              >
                {doneCount === 0 ? "Start" : "Continue"}
              </Link>
            ) : (
              <p className="font-medium">All done. Well done.</p>
            )}
          </div>
          <RuledList>
            {items.map((item) => (
              <li key={item.position}>
                <Link
                  href={`/questions/${item.questionId}?session=${session.id}`}
                  className={`${RULED_ROW_LINK} gap-1.5`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-heading text-lg font-medium">
                      {item.position}.{" "}
                      {item.source === "variant" ? "New variant" : `Retry ${item.label}`}
                      <span className="text-muted-foreground font-sans text-sm font-normal">
                        {" "}
                        · about {item.expectedMinutes} min
                      </span>
                    </span>
                    <Badge variant={item.done ? "secondary" : "outline"}>
                      {item.done ? "Done" : "To do"}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {item.source === "variant"
                      ? `${item.reason.charAt(0).toUpperCase()}${item.reason.slice(1)}.`
                      : `Because ${item.reason}.`}
                  </span>
                  <span className="line-clamp-2 text-sm">
                    <MathText>{item.body}</MathText>
                  </span>
                </Link>
              </li>
            ))}
          </RuledList>
        </>
      ) : null}
    </section>
  );
}
