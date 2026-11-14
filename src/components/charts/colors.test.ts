import { describe, expect, it } from "vitest";

import { masteryColor, NEUTRAL_FILL, OUTCOME_STYLE, textColorOn } from "./colors";

describe("masteryColor", () => {
  it("is neutral grey for null", () => {
    expect(masteryColor(null)).toBe(NEUTRAL_FILL);
    expect(masteryColor(NaN)).toBe(NEUTRAL_FILL);
  });

  it("hits the end stops and clamps", () => {
    expect(masteryColor(0)).toBe("#440154");
    expect(masteryColor(1)).toBe("#fde725");
    expect(masteryColor(-3)).toBe("#440154");
    expect(masteryColor(7)).toBe("#fde725");
  });

  it("gives different colours across the scale and never equals neutral", () => {
    const colours = [0, 0.25, 0.5, 0.75, 1].map(masteryColor);
    expect(new Set(colours).size).toBe(5);
    expect(colours).not.toContain(NEUTRAL_FILL);
  });
});

describe("textColorOn", () => {
  it("picks readable text", () => {
    expect(textColorOn("#440154")).toBe("#ffffff");
    expect(textColorOn("#fde725")).toBe("#000000");
  });
});

describe("OUTCOME_STYLE", () => {
  it("uses a distinct symbol and fill per outcome", () => {
    const styles = Object.values(OUTCOME_STYLE);
    expect(new Set(styles.map((s) => s.symbol)).size).toBe(3);
    expect(new Set(styles.map((s) => s.fill)).size).toBe(3);
  });
});
