"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { AttemptTimer } from "@/components/attempt-timer";
import { HintRungs } from "@/components/charts/hint-rungs";
import { DifficultyRating } from "@/components/difficulty-rating";
import { WorkingInput } from "@/components/working-input";
import { MathText } from "@/components/math-text";
import { Panel } from "@/components/page-parts";
import { Button, buttonVariants } from "@/components/ui/button";
import type { HintLevel } from "@/lib/domain";
import { playSfx } from "@/lib/sfx";
import {
  openAttempt,
  revealNextHint,
  startAttempt,
} from "@/app/(app)/questions/[questionId]/actions";
import type { WorkingFile } from "@/app/(app)/questions/[questionId]/submit-actions";

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
  initialText: string;
  initialFiles: WorkingFile[];
  /** True when the newest attempt's working has been submitted. */
  submitted: boolean;
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
  initialText,
  initialFiles,
  submitted,
  prevHref,
  nextHref,
  children,
}: Props) {
  const [attemptId, setAttemptId] = useState(initialAttemptId);
  const [shown, setShown] = useState<ShownHint[]>(initialHints);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const opened = useRef(false);
  const flushTimer = useRef<() => Promise<void>>(async () => {});
  // A stable function, so the timer's effect does not restart on every render.
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushTimer.current = flush;
  }, []);
  const router = useRouter();

  useEffect(() => {
    if (attemptId || opened.current) return;
    opened.current = true;
    void openAttempt({ questionId, sessionId }).then(
      (result) => setAttemptId(result.attemptId),
      () => setError("Could not start this attempt. Reload the page."),
    );
  }, [attemptId, questionId, sessionId]);

  const level = Math.min(3, shown.length) as HintLevel;

  function startNewAttempt() {
    setError(null);
    startTransition(async () => {
      await startAttempt({ questionId, mode: "fresh", sessionId });
      router.refresh();
    });
  }

  function reveal() {
    if (!attemptId) return;
    setError(null);
    startTransition(async () => {
      const result = await revealNextHint({ attemptId });
      if (!result.ok) return setError(result.error);
      playSfx("hint");
      // The third hint unlocks the worked solution, which the server renders.
      if (result.level === 3) router.refresh();
      setShown((all) =>
        all.some((h) => h.level === result.level)
          ? all
          : [...all, { level: result.level, body: result.body }],
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="hints-heading"
        className="bg-card flex flex-col gap-4 rounded-lg border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="hints-heading" className="text-lg font-medium">
            Hints
          </h2>
          <HintRungs revealed={level} />
        </div>

        {shown.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {shown.map((hint) => (
              <li key={hint.level} className="border-foreground/25 border-l-2 py-0.5 pl-4">
                <p className="text-muted-foreground mb-1 text-xs font-medium">
                  Hint {hint.level} · {HINT_NAMES[hint.level - 1]}
                </p>
                <MathText>{hint.body}</MathText>
              </li>
            ))}
          </ol>
        ) : null}

        {level < 3 && !submitted ? (
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
          <p className="text-muted-foreground text-sm">
            {submitted ? "Hints are locked once you submit." : "All three hints are showing."}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {!timerEnabled ? (
          <span />
        ) : submitted ? (
          <span className="text-muted-foreground text-sm">
            Time spent: {Math.floor(initialSeconds / 60)}:
            {String(initialSeconds % 60).padStart(2, "0")}
          </span>
        ) : (
          <AttemptTimer
            attemptId={attemptId}
            initialSeconds={initialSeconds}
            registerFlush={registerFlush}
          />
        )}
        <DifficultyRating attemptId={attemptId} initialRating={initialRating} />
      </div>

      <WorkingInput
        // A new attempt starts with an empty draft, so remount to drop the old text.
        key={attemptId ?? "none"}
        attemptId={attemptId}
        initialText={initialText}
        initialFiles={initialFiles}
        submitted={submitted}
        beforeSubmit={() => flushTimer.current()}
        onSubmitted={() => router.refresh()}
      />

      {submitted ? (
        <Panel className="flex flex-wrap items-center gap-3">
          <span className="mr-auto">Your working has been submitted.</span>
          <Link
            href={`/questions/${questionId}/mark?attempt=${attemptId}${sessionId ? `&session=${sessionId}` : ""}`}
            className={buttonVariants()}
          >
            See the mark
          </Link>
          <Button type="button" variant="outline" onClick={startNewAttempt} disabled={pending}>
            Start a new attempt
          </Button>
        </Panel>
      ) : null}

      {children}

      <nav
        aria-label="Questions"
        className="flex items-center justify-between border-t pt-4 text-sm"
      >
        {prevHref ? (
          <Link href={prevHref} className={buttonVariants({ variant: "ghost" })}>
            ← Previous question
          </Link>
        ) : (
          <span />
        )}
        {nextHref ? (
          <Link href={nextHref} className={buttonVariants({ variant: "ghost" })}>
            Next question →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
