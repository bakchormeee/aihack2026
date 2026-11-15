import { describe, expect, it } from "vitest";

import { MAX_LONG_EDGE, cropRect, targetSize } from "./image-resize";

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

describe("cropRect", () => {
  it("turns a fractional box into whole pixels of the photo", () => {
    expect(cropRect({ x: 0.1, y: 0.25, w: 0.5, h: 0.5 }, 1500, 2000)).toEqual({
      sx: 150,
      sy: 500,
      sw: 750,
      sh: 1000,
    });
  });

  it("covers the whole photo for the whole box", () => {
    expect(cropRect({ x: 0, y: 0, w: 1, h: 1 }, 1999, 1333)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1999,
      sh: 1333,
    });
  });

  it("keeps a box that runs off the photo inside it", () => {
    expect(cropRect({ x: -0.1, y: 0.9, w: 0.5, h: 0.3 }, 1000, 1000)).toEqual({
      sx: 0,
      sy: 900,
      sw: 400,
      sh: 100,
    });
  });

  it("never gives an empty rectangle, even for a box at the edge", () => {
    expect(cropRect({ x: 1, y: 1, w: 0.2, h: 0.2 }, 100, 50)).toEqual({
      sx: 99,
      sy: 49,
      sw: 1,
      sh: 1,
    });
    expect(cropRect({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 100, 100).sw).toBe(1);
  });

  it("rejects non-positive sizes", () => {
    expect(() => cropRect({ x: 0, y: 0, w: 1, h: 1 }, 0, 10)).toThrow();
  });
});
