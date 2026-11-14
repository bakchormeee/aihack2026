import { AutoRefresh } from "@/components/auto-refresh";
import { SideBySide } from "@/components/side-by-side";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getRemarkProgress,
  getSolutionsReview,
  getVisibleSolution,
  type ReviewItem,
} from "@/db/queries/marking";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import type { Outcome } from "@/lib/domain";
import { isStale } from "@/lib/pipeline/stale";

import { retryNowAction } from "@/app/(app)/questions/[questionId]/mark/actions";
import { retryRemarkAction } from "./actions";
import { SolutionsUploadForm } from "./solutions-upload-form";

// The actions on this page start AI work that can run for several minutes.
export const maxDuration = 300;

const OUTCOME_LABEL: Record<Outcome, string> = {
  full: "Full marks",
  partial: "Partly right",
  stuck: "Stuck",
};

export default async function OfficialSolutionsPage({
  params,
}: PageProps<"/sheets/[sheetId]/solutions">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const sheet = await orNotFound(requireSheet(user.id, sheetId));
  const status = sheet.solutionsStatus;

  const working = status === "extracting" || status === "remarking";
  const stuck = working && isStale(sheet.solutionsStatusUpdatedAt);
  const active = working && !stuck;
  const progress = working ? await getRemarkProgress(user.id, sheetId) : null;

  return (
    <section className="flex flex-col gap-6">
      <AutoRefresh active={active} />
      <h1 className="text-xl font-semibold">Official solutions</h1>

      {status === "none" ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">
            Upload your tutor&apos;s solutions (one PDF, or up to 10 photos). Your submitted working
            is then marked again against them.
          </p>
          <SolutionsUploadForm sheetId={sheetId} label="Upload the official solutions." />
        </div>
      ) : null}

      {active ? (
        <div className="flex flex-col gap-1 rounded-lg border p-4" aria-live="polite">
          <p className="text-sm font-medium">
            {status === "extracting"
              ? "Reading the official solutions…"
              : `Marking your working again against the official solutions… ${progress?.marked ?? 0} of ${progress?.total ?? 0} done`}
          </p>
          <p className="text-muted-foreground text-xs">This page updates by itself.</p>
        </div>
      ) : null}

      {stuck || status === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">
            {stuck
              ? "This is taking longer than expected."
              : "We could not finish with the official solutions."}
          </p>
          <form action={retryRemarkAction.bind(null, sheetId)}>
            <Button type="submit">Try again</Button>
          </form>
        </div>
      ) : null}

      {status === "done" ? <Review sheetId={sheetId} userId={user.id} /> : null}

      {status === "done" || status === "failed" ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Upload different official solutions
          </summary>
          <div className="pt-3">
            <SolutionsUploadForm sheetId={sheetId} label="Upload the official solutions." />
          </div>
        </details>
      ) : null}
    </section>
  );
}

async function Review({ sheetId, userId }: { sheetId: string; userId: string }) {
  const { changed, notFull } = await getSolutionsReview(userId, sheetId);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground text-sm">
        Marks given against the official solutions are labelled as such on each mark screen.
      </p>
      <ReviewList
        title="Marks that changed"
        empty="No mark changed outcome against the official solutions."
        items={changed}
        userId={userId}
      />
      <ReviewList
        title="Still to get right"
        empty="Every question is fully right."
        items={notFull}
        userId={userId}
      />
    </div>
  );
}

function ReviewList({
  title,
  empty,
  items,
  userId,
}: {
  title: string;
  empty: string;
  items: ReviewItem[];
  userId: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-muted-foreground text-sm">{empty}</p> : null}
      {items.map((item) => (
        <ReviewCard key={item.attemptId} item={item} userId={userId} />
      ))}
    </section>
  );
}

async function ReviewCard({ item, userId }: { item: ReviewItem; userId: string }) {
  const solution = await getVisibleSolution(userId, item.question.id, { reviewMode: true });
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Question {item.question.label}</h3>
        <Badge variant={item.mark.outcome === "full" ? "default" : "secondary"}>
          {OUTCOME_LABEL[item.mark.outcome]} · {item.mark.score}/100
        </Badge>
        {item.mark.outcomeChanged && item.earlierAi ? (
          <span className="text-muted-foreground text-xs">
            Was {OUTCOME_LABEL[item.earlierAi.outcome]} ({item.earlierAi.score}/100) when marked
            without the official solutions
          </span>
        ) : null}
        {item.mark.basis === "ai" ? (
          <span className="text-muted-foreground text-xs">Not marked against them yet</span>
        ) : null}
      </div>
      <SideBySide solution={solution} text={item.text} files={item.files} />
      <div>
        <form action={retryNowAction.bind(null, item.question.id, undefined)}>
          <Button type="submit">Retry now</Button>
        </form>
      </div>
    </article>
  );
}
