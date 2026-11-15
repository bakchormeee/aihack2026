import { describe, expect, it } from "vitest";

import {
  DEMO_AI_CALLS,
  DEMO_COPY_HOURS,
  DEMO_MAX_COPIES,
  aiCallsLeft,
  copiesToErase,
  expiryOf,
  isExpired,
  timeShift,
} from "./rules";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-11-15T12:00:00Z");

describe("the limits", () => {
  it("are 24 hours, 30 AI calls and 200 copies (SPEC-demo.md)", () => {
    expect([DEMO_COPY_HOURS, DEMO_AI_CALLS, DEMO_MAX_COPIES]).toEqual([24, 30, 200]);
  });
});

describe("timeShift", () => {
  it("moves the template's newest activity to now", () => {
    const newest = new Date("2026-11-01T09:30:00Z");
    const shift = timeShift(newest, NOW);
    expect(new Date(newest.getTime() + shift)).toEqual(NOW);
  });

  it("is zero when the template has no activity", () => {
    expect(timeShift(null, NOW)).toBe(0);
  });
});

describe("expiry", () => {
  it("is 24 hours after the copy is made", () => {
    expect(expiryOf(NOW)).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });

  it("counts a copy as expired exactly at its expiry time, not a moment before", () => {
    const expiresAt = expiryOf(NOW);
    expect(isExpired(expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(isExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("treats a copy without an expiry as expired", () => {
    expect(isExpired(null, NOW)).toBe(true);
  });
});

describe("copiesToErase", () => {
  const copy = (id: string, hoursAgo: number) => ({
    id,
    createdAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    expiresAt: expiryOf(new Date(NOW.getTime() - hoursAgo * HOUR)),
  });

  it("erases the expired copies only", () => {
    expect(copiesToErase([copy("old", 25), copy("new", 1), copy("edge", 24)], NOW)).toEqual([
      "old",
      "edge",
    ]);
  });

  it("keeps room for one new copy: 200 live copies erase the oldest", () => {
    const copies = Array.from({ length: 200 }, (_, i) => copy(`c${i}`, i * 0.01));
    expect(copiesToErase(copies, NOW)).toEqual(["c199"]);
  });

  it("erases nothing at 199 live copies", () => {
    const copies = Array.from({ length: 199 }, (_, i) => copy(`c${i}`, i * 0.01));
    expect(copiesToErase(copies, NOW)).toEqual([]);
  });

  it("counts only live copies toward the cap, oldest first", () => {
    const copies = [copy("a", 3), copy("b", 2), copy("c", 1), copy("gone", 30)];
    expect(copiesToErase(copies, NOW, 3)).toEqual(["gone", "a"]);
  });
});

describe("aiCallsLeft", () => {
  it("counts down from 30 and never below zero", () => {
    expect(aiCallsLeft(0)).toBe(30);
    expect(aiCallsLeft(29)).toBe(1);
    expect(aiCallsLeft(30)).toBe(0);
    expect(aiCallsLeft(31)).toBe(0);
  });
});
