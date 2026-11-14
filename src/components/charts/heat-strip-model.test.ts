import { describe, expect, it } from "vitest";

import {
  describeCell,
  hintDotCount,
  shortLabel,
  summariseRow,
  type HeatCell,
} from "./heat-strip-model";

const cell = (
  outcome: HeatCell["outcome"],
  hintLevel: HeatCell["hintLevel"],
  label = "Q1",
): HeatCell => ({
  label,
  outcome,
  hintLevel,
});

describe("describeCell", () => {
  it("describes unattempted cells", () => {
    expect(describeCell(cell(null, 0))).toBe("Q1: not attempted");
  });
  it("describes outcome and hints with correct plurals", () => {
    expect(describeCell(cell("full", 0))).toBe("Q1: Full, no hints");
    expect(describeCell(cell("partial", 1))).toBe("Q1: Partial, 1 hint");
    expect(describeCell(cell("stuck", 3))).toBe("Q1: Stuck, 3 hints");
  });
});

describe("hintDotCount", () => {
  it("is zero for unattempted cells whatever the hint level", () => {
    expect(hintDotCount(cell(null, 2))).toBe(0);
  });
  it("equals the hint level for attempted cells", () => {
    expect(hintDotCount(cell("full", 0))).toBe(0);
    expect(hintDotCount(cell("full", 3))).toBe(3);
  });
});

describe("shortLabel / summariseRow", () => {
  it("clips long labels", () => {
    expect(shortLabel("Q1")).toBe("Q1");
    expect(shortLabel("Question 10(b)(ii)")).toBe("Ques");
  });
  it("counts attempted cells", () => {
    expect(summariseRow([cell("full", 0), cell(null, 0), cell("stuck", 1)])).toEqual({
      attempted: 2,
      total: 3,
    });
    expect(summariseRow([])).toEqual({ attempted: 0, total: 0 });
  });
});
