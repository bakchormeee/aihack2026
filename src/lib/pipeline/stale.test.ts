import { describe, expect, it } from "vitest";

import { STALE_JOB_MS } from "@/lib/domain";

import { isStale } from "./stale";

describe("isStale", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("is false for a job that started a moment ago", () => {
    expect(isStale(new Date(now.getTime() - 5_000), now)).toBe(false);
  });

  it("is false exactly at the limit", () => {
    expect(isStale(new Date(now.getTime() - STALE_JOB_MS), now)).toBe(false);
  });

  it("is true just past the limit", () => {
    expect(isStale(new Date(now.getTime() - STALE_JOB_MS - 1), now)).toBe(true);
  });

  it("is false when there is no timestamp", () => {
    expect(isStale(null, now)).toBe(false);
  });
});
