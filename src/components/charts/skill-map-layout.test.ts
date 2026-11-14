import { describe, expect, it } from "vitest";

import {
  cleanLinks,
  computeLayout,
  nodeOpacity,
  nodeRadius,
  truncateLabel,
  MAX_RADIUS,
  MIN_RADIUS,
  type SkillNode,
} from "./skill-map-layout";

const node = (id: string, attempts = 1, extra: Partial<SkillNode> = {}): SkillNode => ({
  id,
  name: id,
  mastery: 0.5,
  confidence: 0.8,
  attempts,
  ...extra,
});

describe("nodeRadius", () => {
  it("is minimal for zero attempts and maximal at the maximum", () => {
    expect(nodeRadius(0, 10)).toBe(MIN_RADIUS);
    expect(nodeRadius(10, 10)).toBe(MAX_RADIUS);
  });
  it("grows with attempts", () => {
    expect(nodeRadius(2, 10)).toBeLessThan(nodeRadius(8, 10));
  });
  it("handles all-zero attempts", () => {
    expect(nodeRadius(0, 0)).toBe(MIN_RADIUS);
  });
});

describe("nodeOpacity", () => {
  it("is 0.4 below 0.3 confidence and 1 otherwise", () => {
    expect(nodeOpacity(0)).toBe(0.4);
    expect(nodeOpacity(0.29)).toBe(0.4);
    expect(nodeOpacity(0.3)).toBe(1);
    expect(nodeOpacity(1)).toBe(1);
  });
});

describe("cleanLinks", () => {
  it("drops unknown endpoints, self links and duplicates", () => {
    const nodes = [node("a"), node("b")];
    expect(
      cleanLinks(nodes, [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
        { source: "a", target: "a" },
        { source: "a", target: "zzz" },
      ]),
    ).toEqual([{ source: "a", target: "b" }]);
  });
});

describe("truncateLabel", () => {
  it("shortens long names with an ellipsis", () => {
    expect(truncateLabel("Short")).toBe("Short");
    expect(truncateLabel("Integration by substitution and parts", 14)).toHaveLength(14);
    expect(truncateLabel("Integration by substitution and parts", 14).endsWith("…")).toBe(true);
  });
});

describe("computeLayout", () => {
  it("returns an empty layout for no nodes", () => {
    expect(computeLayout([], [], 300, 300)).toEqual({ nodes: [], links: [] });
  });

  it("centres a single node", () => {
    const { nodes } = computeLayout([node("a")], [], 300, 300);
    expect(nodes[0].x).toBeCloseTo(150, 0);
  });

  it("keeps 25 nodes inside the box with finite positions", () => {
    const nodes = Array.from({ length: 25 }, (_, i) => node(`t${i}`, i));
    const links = nodes.slice(1).map((n, i) => ({ source: nodes[i].id, target: n.id }));
    const out = computeLayout(nodes, links, 340, 420);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      expect(n.x - n.r).toBeGreaterThanOrEqual(0);
      expect(n.x + n.r).toBeLessThanOrEqual(340);
      expect(n.y - n.r).toBeGreaterThanOrEqual(0);
      expect(n.y + n.r).toBeLessThanOrEqual(420);
    }
    expect(out.links).toHaveLength(24);
  });

  it("is deterministic", () => {
    const nodes = [node("a", 3), node("b", 5), node("c", 0)];
    const links = [{ source: "a", target: "b" }];
    expect(computeLayout(nodes, links, 300, 300)).toEqual(computeLayout(nodes, links, 300, 300));
  });
});
