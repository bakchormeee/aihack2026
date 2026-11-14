"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { AttemptTimer } from "@/components/attempt-timer";
import { HintRungs } from "@/components/charts/hint-rungs";
import { DifficultyRating } from "@/components/difficulty-rating";
import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import type { HintLevel } from "@/lib/domain";
import { openAttempt, revealNextHint } from "@/app/(app)/questions/[questionId]/actions";

const HINT_NAMES = ["Nudge", "Approach", "Skeleton"] as const;

export type ShownHint = { level: number; body: string };

type Props = {
  questionId: string;
  sessionId?: string;
  /** Null until the browser has opened the attempt. */
  initialAttemptId: string | null;
  initialHints: ShownHint[];
  hintsReady: boolean;
  /** Whether the sheet's timer is on. */
  timerEnabled: boolean;
  initialSeconds: number;
  initialRating: number | null;
  prevHref: string | null;
  nextHref: string | null;
  children?: React.ReactNode;
};

/** The attempt screen: hint ladder and hints. Opens the attempt once, from the browser. */
export function QuestionView({
  questionId,
  sessionId,
  initialAttemptId,
  initialHints,
  hintsReady,
  timerEnabled,
  initialSeconds,
  initialRating,
  prevHref,
  nextHref,
  children,
}: Props) {
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [shown, setShown] = useState<ShownHint[]>(initialHints);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const opened = useRef(false);

  useEffect(() => {
    if (attemptId || opened.current) return;
    opened.current = true;
    void openAttempt({ questionId, sessionId }).then(
      (result) => setAttemptId(result.attemptId),
      () => setError("Could not start this attempt. Reload the page."),
    );
  }, [attemptId, questionId, sessionId]);

  const level = Math.min(3, shown.length) as HintLevel;

  function reveal() {
    if (!attemptId) return;
    setError(null);
    startTransition(async () => {
      const result = await revealNextHint({ attemptId });
      if (!result.ok) return setError(result.error);
      setShown((all) =>
        all.some((h) => h.level === result.level)
          ? all
          : [...all, { level: result.level, body: result.body }],
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="hints-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="hints-heading" className="text-base font-semibold">
            Hints
          </h2>
          <HintRungs revealed={level} />
        </div>

        {shown.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {shown.map((hint) => (
              <li key={hint.level} className="rounded-lg border p-3">
                <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">
                  Hint {hint.level} · {HINT_NAMES[hint.level - 1]}
                </p>
                <MathText className="text-sm">{hint.body}</MathText>
              </li>
            ))}
          </ol>
        ) : null}

        {level < 3 ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={reveal}
              disabled={!attemptId || !hintsReady || pending}
            >
              {pending ? "Showing…" : `Show hint ${level + 1} (${HINT_NAMES[level as 0 | 1 | 2]})`}
            </Button>
            {!hintsReady ? (
              <span className="text-muted-foreground text-sm">Hints are being prepared…</span>
            ) : (
              <span className="text-muted-foreground text-sm">
                Try first. Each hint gives away a little more.
              </span>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">All three hints are showing.</p>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {timerEnabled ? (
          <AttemptTimer attemptId={attemptId} initialSeconds={initialSeconds} />
        ) : (
          <span />
        )}
        <DifficultyRating attemptId={attemptId} initialRating={initialRating} />
      </div>

      {children}

      <nav
        aria-label="Questions"
        className="flex items-center justify-between border-t pt-4 text-sm"
      >
        {prevHref ? (
          <Link href={prevHref} className="underline">
            ← Previous question
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link href={nextHref} className="underline">
            Next question →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
