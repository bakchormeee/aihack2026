import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3";

export type SkillNode = {
  id: string;
  name: string;
  mastery: number | null;
  confidence: number;
  attempts: number;
};
export type SkillLink = { source: string; target: string };

export const MIN_RADIUS = 10;
export const MAX_RADIUS = 28;
export const LOW_CONFIDENCE = 0.3;

/** Radius grows with the square root of attempts so that area is proportional to attempts. */
export function nodeRadius(attempts: number, maxAttempts: number): number {
  if (!(attempts > 0) || !(maxAttempts > 0)) return MIN_RADIUS;
  const t = Math.sqrt(Math.min(attempts, maxAttempts) / maxAttempts);
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * t;
}

export function nodeOpacity(confidence: number): number {
  return confidence < LOW_CONFIDENCE ? 0.4 : 1;
}

/** Drops links that point at unknown nodes, self-links and duplicates (in either direction). */
export function cleanLinks(nodes: SkillNode[], links: SkillLink[]): SkillLink[] {
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const out: SkillLink[] = [];
  for (const l of links) {
    if (l.source === l.target || !ids.has(l.source) || !ids.has(l.target)) continue;
    const key = [l.source, l.target].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

export function truncateLabel(name: string, max = 14): string {
  const chars = Array.from(name.trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max - 1).join("") + "…";
}

export type PositionedNode = SkillNode & { x: number; y: number; r: number };

/**
 * Runs the force simulation to rest and returns fixed positions inside the box.
 * Start positions are on a circle, so the result is deterministic.
 */
export function computeLayout(
  nodes: SkillNode[],
  links: SkillLink[],
  width: number,
  height: number,
): { nodes: PositionedNode[]; links: { source: PositionedNode; target: PositionedNode }[] } {
  const maxAttempts = Math.max(0, ...nodes.map((n) => n.attempts));
  const cx = width / 2;
  const cy = height / 2;
  const count = nodes.length;
  const startRadius = Math.min(width, height) / 3;
  const sim = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(count, 1);
    return {
      ...n,
      r: nodeRadius(n.attempts, maxAttempts),
      x: count === 1 ? cx : cx + startRadius * Math.cos(angle),
      y: count === 1 ? cy : cy + startRadius * Math.sin(angle),
    };
  });
  const good = cleanLinks(nodes, links).map((l) => ({ ...l }));

  const simulation = forceSimulation(sim)
    .force(
      "link",
      forceLink<(typeof sim)[number], { source: string; target: string }>(good)
        .id((d) => d.id)
        .distance(Math.max(70, Math.min(width, height) / 4))
        .strength(0.6),
    )
    .force("charge", forceManyBody().strength(-200))
    .force(
      "collide",
      forceCollide<(typeof sim)[number]>().radius((d) => d.r + 16),
    )
    .force("x", forceX(cx).strength(0.04))
    .force("y", forceY(cy).strength(0.04))
    .stop();
  const pad = 8;
  const clamp = () => {
    for (const n of sim) {
      n.x = Math.min(width - n.r - pad, Math.max(n.r + pad, n.x));
      n.y = Math.min(height - n.r - 22, Math.max(n.r + pad, n.y)); // leave room for the label below
    }
  };
  // Clamp on every tick so collision resolves against the walls instead of piling up on them.
  for (let i = 0; i < 400; i++) {
    simulation.tick();
    clamp();
  }
  for (const n of sim) {
    // Round so server and browser floating-point noise cannot cause a hydration mismatch.
    n.x = Math.round(n.x * 10) / 10;
    n.y = Math.round(n.y * 10) / 10;
  }
  const byId = new Map(sim.map((n) => [n.id, n]));
  return {
    nodes: sim,
    links: cleanLinks(nodes, links).map((l) => ({
      source: byId.get(l.source)!,
      target: byId.get(l.target)!,
    })),
  };
}
