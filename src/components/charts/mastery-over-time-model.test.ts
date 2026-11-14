import { describe, expect, it } from "vitest";

import {
  LINE_COLORS,
  lineStyle,
  mergeSeries,
  sortedEvents,
  timeDomain,
  type TopicSeries,
} from "./mastery-over-time-model";

const topics: TopicSeries[] = [
  {
    id: "a",
    name: "A",
    series: [
      { at: "2026-11-03T10:00:00Z", mastery: 0.2 },
      { at: "2026-11-05T10:00:00Z", mastery: 0.6 },
    ],
  },
  { id: "b", name: "B", series: [{ at: "2026-11-05T10:00:00Z", mastery: 1.4 }] },
];

describe("mergeSeries", () => {
  it("merges topics into one sorted row per timestamp", () => {
    const { rows, keys } = mergeSeries(topics);
    expect(keys).toEqual(["a", "b"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].a).toBe(0.2);
    expect(rows[0].b).toBeUndefined();
    expect(rows[1]).toMatchObject({ a: 0.6, b: 1 }); // clamped
  });

  it("drops invalid dates and non-finite mastery, and handles no data", () => {
    const { rows } = mergeSeries([
      {
        id: "x",
        name: "X",
        series: [
          { at: "not a date", mastery: 0.5 },
          { at: "2026-11-01", mastery: NaN },
        ],
      },
    ]);
    expect(rows).toEqual([]);
    expect(mergeSeries([]).rows).toEqual([]);
  });
});

describe("sortedEvents", () => {
  it("sorts and drops invalid dates", () => {
    const out = sortedEvents([
      { at: "2026-11-06", kind: "revision", label: "R" },
      { at: "bad", kind: "sheet", label: "bad" },
      { at: "2026-11-02", kind: "sheet", label: "S" },
    ]);
    expect(out.map((e) => e.label)).toEqual(["S", "R"]);
  });
});

describe("timeDomain", () => {
  it("is null with nothing to plot", () => {
    expect(timeDomain([], [])).toBeNull();
  });
  it("pads a single instant by a day either side", () => {
    const [lo, hi] = timeDomain([{ t: 1_000_000_000 }], [])!;
    expect(hi - lo).toBe(2 * 86_400_000);
  });
  it("covers events outside the data range", () => {
    const [lo, hi] = timeDomain([{ t: 100 }, { t: 200 }], [{ t: 50 }, { t: 300 }])!;
    expect(lo).toBeLessThan(50);
    expect(hi).toBeGreaterThan(300);
  });
});

describe("lineStyle", () => {
  it("uses distinct colours then changes dash when the palette wraps", () => {
    expect(lineStyle(0).dash).toBeUndefined();
    expect(lineStyle(LINE_COLORS.length).color).toBe(lineStyle(0).color);
    expect(lineStyle(LINE_COLORS.length).dash).not.toBe(lineStyle(0).dash);
  });
});
