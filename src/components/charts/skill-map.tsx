"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { MASTERY_GRADIENT, masteryColor, NEUTRAL_FILL, textColorOn } from "./colors";
import {
  computeLayout,
  nodeOpacity,
  truncateLabel,
  type SkillLink,
  type SkillNode,
} from "./skill-map-layout";

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

/** Force-directed topic map. Colour = mastery, size = attempts, faded = low confidence. */
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

  const height =
    nodes.length <= 1
      ? 140
      : Math.round(Math.min(900, Math.max(300, width * 0.65, nodes.length * 36)));
  const layout = useMemo(
    () => computeLayout(nodes, links, width, height),
    [nodes, links, width, height],
  );

  if (nodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No topics yet. Upload a problem sheet and attempt some questions to build your skill map.
      </p>
    );
  }

  const go = (id: string) => router.push(hrefForTopic(id));
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go(id);
    }
  };

  return (
    <figure className="w-full">
      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label="Skill map of topics"
          className="block max-w-full"
        >
          <g stroke="currentColor" strokeOpacity={0.3} strokeWidth={1.5}>
            {layout.links.map((l, i) => (
              <line key={i} x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y} />
            ))}
          </g>
          {layout.nodes.map((n) => {
            const fill = masteryColor(n.mastery);
            const label = truncateLabel(n.name);
            return (
              <g
                key={n.id}
                role="link"
                tabIndex={0}
                aria-label={describe(n)}
                onClick={() => go(n.id)}
                onKeyDown={(e) => onKey(e, n.id)}
                className="group cursor-pointer outline-none"
                transform={`translate(${n.x},${n.y})`}
              >
                <title>{describe(n)}</title>
                <circle
                  r={n.r + 5}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  className="opacity-0 group-focus-visible:opacity-100"
                />
                <g opacity={nodeOpacity(n.confidence)}>
                  <circle
                    r={n.r}
                    fill={fill}
                    stroke="currentColor"
                    strokeWidth={n.mastery === null ? 1.5 : 1}
                    strokeDasharray={n.mastery === null ? "3 2" : undefined}
                  />
                  {n.r >= 14 && (
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
                  y={n.r + 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill="currentColor"
                  opacity={nodeOpacity(n.confidence) === 1 ? 1 : 0.7}
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
          Circle size and number = attempts. Faded = low confidence. Select a topic to open it.
        </div>
      </figcaption>
    </figure>
  );
}
