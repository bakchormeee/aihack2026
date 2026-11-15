import Link from "next/link";

import { masteryBand, masteryColor } from "@/components/charts/colors";
import { Panel, SectionTitle } from "@/components/page-parts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { focusTopics, reviewSummary, type TopicForFocus } from "@/lib/insights/insights";

/** Mastery on a 0–100% track in the diverging mastery colour, with a 50% tick and the value in words. */
function MasteryBar({ value, label }: { value: number | null; label: string }) {
  const percent = value === null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : percent}
        aria-valuetext={value === null ? "Not tried yet" : `${percent}%, ${masteryBand(value)}`}
        className="bg-muted relative h-2 w-full max-w-56 overflow-hidden rounded-full"
      >
        {value !== null ? (
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(percent, 3)}%`, backgroundColor: masteryColor(value) }}
          />
        ) : null}
        <span aria-hidden="true" className="bg-foreground/35 absolute inset-y-0 left-1/2 w-px" />
      </div>
      <span className="shrink-0 text-sm tabular-nums">
        {value === null ? (
          <span className="text-muted-foreground">Not tried yet</span>
        ) : (
          <>
            <strong className="font-semibold">{percent}%</strong>{" "}
            <span className="text-muted-foreground">{masteryBand(value)}</span>
          </>
        )}
      </span>
    </div>
  );
}

/** "Focus next": the few topics most worth practising now, why, and one-click ways to practise. */
export function FocusNext({ courseId, topics }: { courseId: string; topics: TopicForFocus[] }) {
  const items = focusTopics(topics, new Date(), 3);
  if (items.length === 0) return null;
  const summary = reviewSummary(topics);

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle>Focus next</SectionTitle>
        <p className="text-muted-foreground text-xs">
          {summary ?? "Weakest, least certain and longest-unpractised first."}
        </p>
      </div>
      <ol className="divide-y">
        {items.map((item, i) => (
          <li
            key={item.id}
            className="grid gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="flex min-w-0 gap-3">
              <span aria-hidden="true" className="text-muted-foreground w-4 shrink-0 text-right">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.name}</span>
                  {item.due ? (
                    <Badge variant={item.due.isDue ? "default" : "outline"}>{item.due.text}</Badge>
                  ) : null}
                </span>
                <MasteryBar value={item.mastery} label={`Mastery of ${item.name}`} />
                <p className="text-muted-foreground text-sm">{item.reason}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pl-7 sm:pl-0">
              <Link
                href={`/revise?course=${courseId}&topic=${item.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                Practise
              </Link>
              {item.attempts > 0 ? (
                <Link
                  href={`/revise?course=${courseId}&topic=${item.id}&mode=spot_error`}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  Spot the error
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
