import { cleanLinks, nodeRadius, type SkillLink, type SkillNode } from "./skill-map-layout";

export type Node3D = SkillNode & { x: number; y: number; z: number; r: number };

/**
 * A small deterministic 3D force layout: nodes start on a Fibonacci sphere, repel
 * each other, linked topics pull together, and everything is held near the
 * centre. Positions come back scaled to fit a unit-ish ball of radius `size`.
 */
export function computeLayout3D(
  nodes: SkillNode[],
  links: SkillLink[],
  size: number,
): { nodes: Node3D[]; links: [number, number][] } {
  const n = nodes.length;
  const maxAttempts = Math.max(0, ...nodes.map((t) => t.attempts));
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pos = nodes.map((_, i) => {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    return [Math.cos(golden * i) * rad, y, Math.sin(golden * i) * rad];
  });
  const index = new Map(nodes.map((t, i) => [t.id, i]));
  const edges = cleanLinks(nodes, links).map(
    (l) => [index.get(l.source)!, index.get(l.target)!] as [number, number],
  );

  for (let step = 0; step < 300; step++) {
    const alpha = 0.05 * (1 - step / 300);
    const force = pos.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = [0, 1, 2].map((k) => pos[i][k] - pos[j][k]);
        const dist2 = Math.max(0.01, d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
        const f = 0.3 / dist2;
        for (let k = 0; k < 3; k++) {
          force[i][k] += d[k] * f;
          force[j][k] -= d[k] * f;
        }
      }
    }
    for (const [a, b] of edges) {
      for (let k = 0; k < 3; k++) {
        const d = pos[b][k] - pos[a][k];
        force[a][k] += d * 0.6;
        force[b][k] -= d * 0.6;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) pos[i][k] += (force[i][k] - pos[i][k] * 0.4) * alpha * 10;
    }
  }

  const extent = Math.max(0.001, ...pos.map((p) => Math.hypot(p[0], p[1], p[2])));
  return {
    nodes: nodes.map((t, i) => ({
      ...t,
      x: (pos[i][0] / extent) * size,
      y: (pos[i][1] / extent) * size,
      z: (pos[i][2] / extent) * size,
      r: nodeRadius(t.attempts, maxAttempts),
    })),
    links: edges,
  };
}

/** Rotates a point about the y axis, then the x axis, and projects it with perspective. */
export function project(
  p: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  distance: number,
) {
  const x1 = p.x * Math.cos(yaw) + p.z * Math.sin(yaw);
  const z1 = -p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
  const y2 = p.y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = p.y * Math.sin(pitch) + z1 * Math.cos(pitch);
  const scale = distance / (distance + z2);
  return { x: x1 * scale, y: y2 * scale, depth: z2, scale };
}
