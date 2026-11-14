// Attempt timer logic (task M7): pure state changes, so the pause rules are testable.
// The timer pauses when the student pauses it, and when the tab loses focus.
// A pause the student chose is never undone by the tab regaining focus.

export type TimerState = {
  accumulatedMs: number;
  /** When the clock last started running, or null while paused. */
  runningSince: number | null;
  manuallyPaused: boolean;
};

export function initialTimer(savedSeconds: number, now: number): TimerState {
  return {
    accumulatedMs: Math.max(0, savedSeconds) * 1000,
    runningSince: now,
    manuallyPaused: false,
  };
}

function stop(state: TimerState, now: number): TimerState {
  if (state.runningSince === null) return state;
  return {
    ...state,
    accumulatedMs: state.accumulatedMs + Math.max(0, now - state.runningSince),
    runningSince: null,
  };
}

export function pauseManually(state: TimerState, now: number): TimerState {
  return { ...stop(state, now), manuallyPaused: true };
}

export function resumeManually(state: TimerState, now: number): TimerState {
  return { ...state, manuallyPaused: false, runningSince: state.runningSince ?? now };
}

export function onBlur(state: TimerState, now: number): TimerState {
  return stop(state, now);
}

export function onFocus(state: TimerState, now: number): TimerState {
  if (state.manuallyPaused || state.runningSince !== null) return state;
  return { ...state, runningSince: now };
}

export function elapsedSeconds(state: TimerState, now: number): number {
  const running = state.runningSince === null ? 0 : Math.max(0, now - state.runningSince);
  return Math.floor((state.accumulatedMs + running) / 1000);
}
