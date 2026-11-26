"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BAND_LABEL,
  BAND_LEGEND,
  masteryBand,
  masteryLine,
  orderTopics,
  type MasteryBandId,
} from "@/lib/mastery/band";
import { cn } from "@/lib/utils";

export type TopicRow = {
  id: string;
  name: string;
  mastery: number | null;
  /** Every attempt that feeds the mastery (long-form and spot-the-error): the tooltip's count. */
  attempts: number;
  /** Marked long-form attempts only: what the word label counts. */
  longFormAttempts: number;
  /** Names of the topics this one needs first. */
  prereqs: string[];
};

const BAND_CLASS: Record<MasteryBandId, string> = {
  needs_work: "bg-destructive/10 text-destructive",
  getting_there: "bg-amber-500/15 text-amber-900 dark:text-amber-300",
  solid: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  too_early: "border-border text-muted-foreground border",
};

/** One row open at a time: choosing the open row closes it, choosing another moves the opening. */
export function toggleOpen(current: string | null, chosen: string): string | null {
  return current === chosen ? null : chosen;
}

/**
 * The course's topics as a plain list, weakest first, each with a word label. The percentage is
 * only in the label's tooltip (hover or focus) and in the open row, which is how a touch screen
 * gets it.
 */
export function TopicList({
  courseId,
  topics,
  defaultOpenId = null,
}: {
  courseId: string;
  topics: TopicRow[];
  /** The row open at first; none by default. */
  defaultOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <ol className="bg-card divide-y overflow-hidden rounded-lg border">
          {orderTopics(topics).map((t) => {
            const band = masteryBand(t.mastery, t.longFormAttempts);
            const line = masteryLine(t.mastery, t.attempts);
            const open = openId === t.id;
            const panelId = `topic-${t.id}`;
            return (
              <li key={t.id} data-topic-name={t.name}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={open ? panelId : undefined}
                        onClick={() => setOpenId((current) => toggleOpen(current, t.id))}
                        className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
                      />
                    }
                  >
                    <span className="font-medium">{t.name}</span>
                    <span
                      data-band={band}
                      className={cn(
                        "inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium whitespace-nowrap",
                        BAND_CLASS[band],
                      )}
                    >
                      {BAND_LABEL[band]}
                    </span>
                    {open ? null : <span className="sr-only">{line}</span>}
                  </TooltipTrigger>
                  <TooltipContent>{line}</TooltipContent>
                </Tooltip>
                {open ? (
                  <div id={panelId} className="flex flex-col gap-3 px-5 pt-1 pb-4">
                    <p className="text-muted-foreground text-sm">{line}</p>
                    {t.prereqs.length > 0 ? (
                      <p className="text-muted-foreground text-sm">Needs: {t.prereqs.join(", ")}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/revise?course=${courseId}&topic=${t.id}`}
                        className={buttonVariants({ size: "sm" })}
                      >
                        Revise
                      </Link>
                      <Link
                        href={`/revise?course=${courseId}&topic=${t.id}&mode=spot_error`}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                      >
                        Spot the error
                      </Link>
                      <Link
                        href={`/courses/${courseId}/mistakes?topic=${t.id}`}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                      >
                        See mistakes
                      </Link>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="text-muted-foreground text-xs">{BAND_LEGEND}</p>
      </div>
    </TooltipProvider>
  );
}
