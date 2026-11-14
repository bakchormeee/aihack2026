"use client";

import { useEffect, useRef, useState } from "react";

import { saveSeconds } from "@/app/(app)/questions/[questionId]/timer-actions";
import { Button } from "@/components/ui/button";
import {
  elapsedSeconds,
  initialTimer,
  onBlur,
  onFocus,
  pauseManually,
  resumeManually,
  type TimerState,
} from "@/lib/timer";

const SAVE_EVERY_MS = 15_000;

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Props = { attemptId: string | null; initialSeconds: number };

/** Counts the time on this question. Pauses by itself when the tab loses focus. */
export function AttemptTimer({ attemptId, initialSeconds }: Props) {
  const timer = useRef<TimerState | null>(null);
  const [seconds, setSeconds] = useState(initialSeconds);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!attemptId) return;
    timer.current = initialTimer(initialSeconds, Date.now());
    let lastSaved = initialSeconds;

    const current = () => (timer.current ? elapsedSeconds(timer.current, Date.now()) : 0);
    const save = () => {
      const value = current();
      if (value <= lastSaved) return;
      lastSaved = value;
      void saveSeconds({ attemptId, seconds: value }).catch(() => {});
    };
    const refresh = () => {
      setSeconds(current());
      setPaused(timer.current?.runningSince === null);
    };

    const tick = setInterval(refresh, 1000);
    const saver = setInterval(save, SAVE_EVERY_MS);
    const blur = () => {
      if (timer.current) timer.current = onBlur(timer.current, Date.now());
      save();
      refresh();
    };
    const focus = () => {
      if (timer.current) timer.current = onFocus(timer.current, Date.now());
      refresh();
    };
    const visibility = () => (document.visibilityState === "hidden" ? blur() : focus());

    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      save();
      clearInterval(tick);
      clearInterval(saver);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [attemptId, initialSeconds]);

  function toggle() {
    if (!timer.current) return;
    const now = Date.now();
    timer.current = timer.current.manuallyPaused
      ? resumeManually(timer.current, now)
      : pauseManually(timer.current, now);
    setSeconds(elapsedSeconds(timer.current, now));
    setPaused(timer.current.runningSince === null);
  }

  return (
    <div className="flex items-center gap-3" role="timer" aria-label="Time on this question">
      <span className="font-mono text-lg tabular-nums">{format(seconds)}</span>
      <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={!attemptId}>
        {paused ? "Resume" : "Pause"}
      </Button>
    </div>
  );
}
