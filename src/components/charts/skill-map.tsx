"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { MASTERY_GRADIENT, masteryColor, NEUTRAL_FILL, textColorOn } from "./colors";
import { computeLayout3D, project } from "./skill-map-3d";
import { nodeOpacity, truncateLabel, type SkillLink, type SkillNode } from "./skill-map-layout";

export type SkillMapProps = {
  nodes: SkillNode[];
  links: SkillLink[];
  hrefForTopic: (topicId: string) => string;
};

function describe(n: SkillNode): string {
  const mastery = n.mastery === null ? "no mastery yet" : `mastery ${Math.round(n.mastery * 100)}%`;
  const low = n.confidence < 0.3 ? ", low confidence" : "";
  return `${n.name}: ${mastery}, ${n.attempts} ${n.attempts === 1 ? "attempt" : "attempts"}${low}`;
}

/**
 * A slowly turning 3D topic map: spheres joined by their prerequisite links. Drag to
 * turn it. Colour = mastery, size = attempts, faded = low confidence.
 */
export function SkillMap({ nodes, links, hrefForTopic }: SkillMapProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes.length]);

  const height = nodes.length <= 1 ? 160 : Math.round(Math.min(640, Math.max(320, width * 0.6)));
  const ball = Math.max(60, Math.min(width, height) / 2 - 48);
  const layout = useMemo(() => computeLayout3D(nodes, links, ball), [nodes, links, ball]);

  // The map turns on its own unless the viewer prefers less motion, is hovering it,
  // or is a test browser (which needs nodes to hold still to click them).
  const [angle, setAngle] = useState({ yaw: 0.6, pitch: -0.35 });
  const hover = useRef(false);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      navigator.webdriver ||
      nodes.length < 2
    )
      return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      if (!hover.current && !drag.current) setAngle((a) => ({ ...a, yaw: a.yaw + dt * 0.00018 }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [nodes.length]);

  // A drag that turned the map must not also open the topic under the pointer.
  const moved = useRef(false);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    moved.current = false;
    drag.current = { x: e.clientX, y: e.clientY, ...angle };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || e.buttons === 0) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) return;
    moved.current = true;
    setAngle({
      yaw: d.yaw + (e.clientX - d.x) * 0.01,
      pitch: Math.max(-1.2, Math.min(1.2, d.pitch + (e.clientY - d.y) * 0.01)),
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  const distance = ball * 3;
  const cx = width / 2;
  const cy = height / 2;
  const placed = layout.nodes.map((n) => {
    const p = project(n, angle.yaw, angle.pitch, distance);
    return { ...n, px: cx + p.x, py: cy + p.y, pr: n.r * p.scale, depth: p.depth };
  });
  const order = [...placed].sort((a, b) => b.depth - a.depth);
  const fog = (depth: number) => 0.55 + 0.45 * ((ball - depth) / (2 * ball));

  if (nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No topics yet. Upload a problem sheet and attempt some questions to build your skill map.
      </p>
    );
  }

  const go = (id: string) => {
    if (!moved.current) router.push(hrefForTopic(id));
  };
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go(id);
    }
  };

  return (
    <figure className="w-full min-w-0">
      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Skill map of topics"
          className="block max-w-full cursor-grab touch-pan-y select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerEnter={() => (hover.current = true)}
          onPointerLeave={() => {
            hover.current = false;
            endDrag();
          }}
        >
          <defs>
            <radialGradient id="skill-sphere-shine" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.85} />
              <stop offset="35%" stopColor="#ffffff" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#000000" stopOpacity={0.35} />
            </radialGradient>
            <radialGradient id="skill-floor" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.08} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </radialGradient>
          </defs>
          <ellipse
            cx={cx}
            cy={cy + ball * 0.95}
            rx={ball * 1.1}
            ry={ball * 0.22}
            fill="url(#skill-floor)"
          />
          <g stroke="currentColor" strokeLinecap="round">
            {layout.links.map(([a, b], i) => {
              const s1 = placed[a];
              const t1 = placed[b];
              const f = fog((s1.depth + t1.depth) / 2);
              return (
                <line
                  key={i}
                  x1={s1.px}
                  y1={s1.py}
                  x2={t1.px}
                  y2={t1.py}
                  strokeOpacity={0.12 + 0.3 * f}
                  strokeWidth={0.8 + 1.4 * f}
                />
              );
            })}
          </g>
          {order.map((n) => {
            const fill = masteryColor(n.mastery);
            const label = truncateLabel(n.name);
            const f = fog(n.depth);
            return (
              <g
                key={n.id}
                role="link"
                tabIndex={0}
                aria-label={describe(n)}
                onClick={() => go(n.id)}
                onKeyDown={(e) => onKey(e, n.id)}
                className="group cursor-pointer outline-none"
                transform={`translate(${n.px},${n.py})`}
              >
                <title>{describe(n)}</title>
                <circle
                  r={n.pr + 5}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  className="opacity-0 group-focus-visible:opacity-100"
                />
                <g
                  opacity={nodeOpacity(n.confidence) * f}
                  className="origin-center transition-transform duration-200 [transform-box:fill-box] group-hover:scale-110"
                >
                  <circle
                    r={n.pr}
                    fill={fill}
                    stroke={n.mastery === null ? "currentColor" : "none"}
                    strokeWidth={1.5}
                    strokeDasharray={n.mastery === null ? "3 2" : undefined}
                  />
                  <circle r={n.pr} fill="url(#skill-sphere-shine)" />
                  {n.pr >= 14 && (
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={11}
                      fontWeight={600}
                      fill={textColorOn(fill)}
                      aria-hidden="true"
                    >
                      {n.attempts}
                    </text>
                  )}
                </g>
                <text
                  y={n.pr + 13}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="currentColor"
                  opacity={(nodeOpacity(n.confidence) === 1 ? 1 : 0.7) * f}
                  paintOrder="stroke"
                  stroke="var(--card)"
                  strokeWidth={3}
                  aria-hidden="true"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="mt-2 space-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Mastery</span>
          <span>low</span>
          <span
            aria-hidden="true"
            className="h-2.5 w-28 rounded-full border"
            style={{ backgroundImage: MASTERY_GRADIENT }}
          />
          <span>high</span>
          <span
            aria-hidden="true"
            className="ml-2 inline-block size-3 rounded-full border border-dashed"
            style={{ backgroundColor: NEUTRAL_FILL }}
          />
          <span>no data</span>
        </div>
        <div>
          Sphere size and number = attempts. Faded = low confidence. Drag to turn the map; select a
          topic to open it.
        </div>
      </figcaption>
    </figure>
  );
}
