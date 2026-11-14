import { describe, expect, it } from "vitest";

import {
  elapsedSeconds,
  initialTimer,
  onBlur,
  onFocus,
  pauseManually,
  resumeManually,
} from "./timer";

const t0 = 1_000_000;
const sec = (n: number) => n * 1000;

describe("timer", () => {
  it("counts from the moment it starts", () => {
    const timer = initialTimer(0, t0);

    expect(elapsedSeconds(timer, t0 + sec(42))).toBe(42);
  });

  it("starts from the seconds already saved", () => {
    const timer = initialTimer(100, t0);

    expect(elapsedSeconds(timer, t0 + sec(5))).toBe(105);
  });

  it("stops counting while paused and resumes where it stopped", () => {
    let timer = initialTimer(0, t0);
    timer = pauseManually(timer, t0 + sec(10));

    expect(elapsedSeconds(timer, t0 + sec(100))).toBe(10);

    timer = resumeManually(timer, t0 + sec(100));
    expect(elapsedSeconds(timer, t0 + sec(105))).toBe(15);
  });

  it("pauses when the tab loses focus and resumes when it returns", () => {
    let timer = initialTimer(0, t0);
    timer = onBlur(timer, t0 + sec(20));
    expect(elapsedSeconds(timer, t0 + sec(500))).toBe(20);

    timer = onFocus(timer, t0 + sec(500));
    expect(elapsedSeconds(timer, t0 + sec(510))).toBe(30);
  });

  it("stays paused on return if the student paused it themselves", () => {
    let timer = initialTimer(0, t0);
    timer = pauseManually(timer, t0 + sec(10));
    timer = onBlur(timer, t0 + sec(20));
    timer = onFocus(timer, t0 + sec(30));

    expect(elapsedSeconds(timer, t0 + sec(60))).toBe(10);
  });

  it("does not double count when blur arrives twice", () => {
    let timer = initialTimer(0, t0);
    timer = onBlur(timer, t0 + sec(10));
    timer = onBlur(timer, t0 + sec(50));

    expect(elapsedSeconds(timer, t0 + sec(90))).toBe(10);
  });

  it("does not double count when focus arrives twice", () => {
    let timer = initialTimer(0, t0);
    timer = onFocus(timer, t0 + sec(5));
    timer = onFocus(timer, t0 + sec(8));

    expect(elapsedSeconds(timer, t0 + sec(10))).toBe(10);
  });

  it("a manual pause during a blur pause keeps it paused after the tab returns", () => {
    let timer = initialTimer(0, t0);
    timer = onBlur(timer, t0 + sec(10));
    timer = pauseManually(timer, t0 + sec(12));
    timer = onFocus(timer, t0 + sec(20));

    expect(elapsedSeconds(timer, t0 + sec(100))).toBe(10);
  });

  it("returns whole seconds, rounding down", () => {
    const timer = initialTimer(0, t0);

    expect(elapsedSeconds(timer, t0 + 1999)).toBe(1);
  });

  it("never goes negative if the clock moves backwards", () => {
    const timer = initialTimer(0, t0);

    expect(elapsedSeconds(timer, t0 - sec(5))).toBe(0);
  });
});
