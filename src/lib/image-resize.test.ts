import { describe, expect, it } from "vitest";

import { MAX_LONG_EDGE, targetSize } from "./image-resize";

describe("targetSize", () => {
  it("leaves a small image unchanged", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600, resized: false });
  });

  it("leaves an image exactly at the limit unchanged", () => {
    expect(targetSize(MAX_LONG_EDGE, 1000)).toEqual({
      width: MAX_LONG_EDGE,
      height: 1000,
      resized: false,
    });
  });

  it("scales a wide image so the long edge is the limit and keeps the ratio", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2000, height: 1500, resized: true });
  });

  it("scales a tall phone photo", () => {
    expect(targetSize(3024, 4032)).toEqual({ width: 1500, height: 2000, resized: true });
  });

  it("never returns a side below 1 pixel", () => {
    const result = targetSize(20000, 3);

    expect(result.width).toBe(2000);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("rejects non-positive sizes", () => {
    expect(() => targetSize(0, 100)).toThrow();
    expect(() => targetSize(100, -1)).toThrow();
  });
});
