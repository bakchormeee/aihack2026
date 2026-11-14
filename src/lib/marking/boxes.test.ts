import { describe, expect, it } from "vitest";

import { boxStyle, padBox } from "./boxes";

describe("padBox", () => {
  it("grows a box a little on every side, since the marker's positions are approximate", () => {
    const box = padBox({ x: 0.2, y: 0.4, width: 0.4, height: 0.1 });

    expect(box.x).toBeCloseTo(0.185);
    expect(box.y).toBeCloseTo(0.385);
    expect(box.width).toBeCloseTo(0.43);
    expect(box.height).toBeCloseTo(0.13);
  });

  it("keeps a padded box inside the image", () => {
    const box = padBox({ x: 0, y: 0.95, width: 1, height: 0.05 });

    expect(box.x).toBe(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(1);
    expect(box.width).toBe(1);
  });
});

describe("boxStyle", () => {
  it("gives percentages of the image, so the box scales with the screen", () => {
    expect(boxStyle({ x: 0.1, y: 0.25, width: 0.5, height: 0.125 })).toEqual({
      left: "10%",
      top: "25%",
      width: "50%",
      height: "12.5%",
    });
  });
});
