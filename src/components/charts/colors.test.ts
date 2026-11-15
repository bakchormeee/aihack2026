import { describe, expect, it } from "vitest";

import { ERROR_TYPES } from "@/lib/domain";
import { severityOf } from "@/lib/marking/rules";

import {
  ERROR_TYPE_ORDER,
  masteryBand,
  masteryColor,
  NEUTRAL_FILL,
  OUTCOME_STYLE,
  textColorOn,
} from "./colors";

describe("masteryColor", () => {
  it("is neutral grey for null", () => {
    expect(masteryColor(null)).toBe(NEUTRAL_FILL);
    expect(masteryColor(NaN)).toBe(NEUTRAL_FILL);
  });

  it("hits the end stops and the neutral midpoint, and clamps", () => {
    expect(masteryColor(0)).toBe("#a32c2c");
    expect(masteryColor(0.5)).toBe("#d9d5cc");
    expect(masteryColor(1)).toBe("#1c5cab");
    expect(masteryColor(-3)).toBe("#a32c2c");
    expect(masteryColor(7)).toBe("#1c5cab");
  });

  it("gives different colours across the scale and never equals neutral", () => {
    const colours = [0, 0.25, 0.5, 0.75, 1].map(masteryColor);
    expect(new Set(colours).size).toBe(5);
    expect(colours).not.toContain(NEUTRAL_FILL);
  });
});

describe("masteryBand", () => {
  it("names every part of the scale", () => {
    expect(masteryBand(null)).toBe("Not tried yet");
    expect(masteryBand(0.1)).toBe("Needs work");
    expect(masteryBand(0.4)).toBe("Shaky");
    expect(masteryBand(0.6)).toBe("Getting there");
    expect(masteryBand(0.9)).toBe("Secure");
  });
});

describe("textColorOn", () => {
  it("picks readable text", () => {
    expect(textColorOn("#a32c2c")).toBe("#ffffff");
    expect(textColorOn("#d9d5cc")).toBe("#000000");
  });
});

describe("OUTCOME_STYLE", () => {
  it("uses a distinct symbol, fill and label per outcome, with readable ink", () => {
    const styles = Object.values(OUTCOME_STYLE);
    expect(new Set(styles.map((s) => s.symbol)).size).toBe(3);
    expect(new Set(styles.map((s) => s.fill)).size).toBe(3);
    expect(OUTCOME_STYLE.partial.label).toBe("Partly right");
    // Labels inside status fills are white, except dark ink on the amber warning (APCA).
    expect(OUTCOME_STYLE.partial.ink).toBe("#000000");
    expect(OUTCOME_STYLE.full.ink).toBe("#ffffff");
    expect(OUTCOME_STYLE.stuck.ink).toBe("#ffffff");
  });
});

describe("ERROR_TYPE_ORDER", () => {
  it("lists every error type once, structural before careless", () => {
    expect([...ERROR_TYPE_ORDER].sort()).toEqual([...ERROR_TYPES].sort());
    const firstCareless = ERROR_TYPE_ORDER.findIndex((t) => severityOf(t) === "careless");
    expect(ERROR_TYPE_ORDER.slice(firstCareless).every((t) => severityOf(t) === "careless")).toBe(
      true,
    );
  });
});
