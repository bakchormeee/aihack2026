"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { NEUTRAL_FILL, OUTCOME_STYLE } from "@/components/charts/colors";
import { focusAfterKey, visibleDots, type TimelineDot } from "@/lib/scores/timeline";

/** The address of the question page with one attempt selected. */
export function attemptHref(questionId: string, attemptId: string, sessionId?: string): string {
  return `/questions/${questionId}?attempt=${attemptId}${sessionId ? `&session=${sessionId}` : ""}`;
}

/**
 * One dot per submitted attempt, oldest on the left, coloured by outcome and dated. The
 * selected attempt is ringed. A dot is a link, so Enter chooses it and the choice is in the
 * address; the arrow keys move between dots.
 */
export function AttemptTimeline({
  dots,
  questionId,
  sessionId,
}: {
  dots: TimelineDot[];
  questionId: string;
  sessionId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const { shown, hiddenCount } = visibleDots(dots, expanded);
  if (dots.length < 2) return null;

  const selectedIndex = Math.max(
    0,
    shown.findIndex((dot) => dot.selected),
  );

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next = focusAfterKey(event.key, index, shown.length);
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <nav aria-label="Attempts" className="flex flex-wrap items-start gap-x-1 gap-y-3">
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-muted-foreground hover:text-foreground mt-1 mr-2 rounded px-1 text-xs underline-offset-4 hover:underline"
        >
          +{hiddenCount} earlier
        </button>
      ) : null}
      {shown.map((dot, index) => {
        const fill = dot.outcome ? OUTCOME_STYLE[dot.outcome].fill : NEUTRAL_FILL;
        return (
          <Link
            key={dot.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            href={attemptHref(questionId, dot.id, sessionId)}
            aria-label={dot.name}
            aria-current={dot.selected ? "true" : undefined}
            tabIndex={index === selectedIndex ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="focus-visible:ring-ring flex min-w-14 flex-col items-center gap-1 rounded-md px-1 py-1 outline-none focus-visible:ring-2"
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full"
              style={{
                backgroundColor: dot.outcome ? fill : "transparent",
                border: dot.outcome ? undefined : `2px solid ${fill}`,
                boxShadow: dot.selected
                  ? "0 0 0 2px var(--background), 0 0 0 4px var(--foreground)"
                  : undefined,
              }}
            />
            <span
              aria-hidden="true"
              className={`text-xs ${dot.selected ? "text-foreground font-medium" : "text-muted-foreground"}`}
            >
              {dot.dateLabel}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
