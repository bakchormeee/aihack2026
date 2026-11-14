import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { MathText } from "@/components/math-text";
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
    <section className="flex flex-col gap-4">
      <AutoRefresh active={building} />
      <div>
        <Link
          href={`/courses/${session.courseId}`}
          className="text-muted-foreground text-sm underline"
        >
          Course
        </Link>
        <h1 className="text-xl font-semibold">Revision session, {session.targetMinutes} minutes</h1>
      </div>

      {building ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="text-muted-foreground text-sm">
            Choosing questions and writing fresh variants. This takes a minute.
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
          <p className="text-muted-foreground text-sm">
            {doneCount} of {items.length} done.
          </p>
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.position}>
                <Link
                  href={`/questions/${item.questionId}?session=${session.id}`}
                  className="hover:bg-muted flex flex-col gap-1 rounded-lg border p-3"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {item.position}.{" "}
                      {item.source === "variant" ? "New variant" : `Retry ${item.label}`}
                      <span className="text-muted-foreground text-sm font-normal">
                        {" "}
                        · about {item.expectedMinutes} min
                      </span>
                    </span>
                    <Badge variant={item.done ? "secondary" : "outline"}>
                      {item.done ? "Done" : "To do"}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground text-sm">Because {item.reason}.</span>
                  <span className="line-clamp-2 text-sm">
                    <MathText>{item.body}</MathText>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {next ? (
            <Link
              href={`/questions/${next.questionId}?session=${session.id}`}
              className={buttonVariants({ className: "self-start" })}
            >
              {doneCount === 0 ? "Start" : "Continue"}
            </Link>
          ) : (
            <p className="text-sm font-medium">All done. Well done.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
