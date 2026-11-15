"use client";

// Adjusting a box on a photo by dragging its corners, moving it, or drawing a new
// one. Pointer events, so a mouse, a pen and a finger all work. Boxes are fractions
// of the photo (src/lib/batch/regions.ts).

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { clampBox, type Box } from "@/lib/batch/regions";
import { cn } from "@/lib/utils";

export type Corner = "nw" | "ne" | "sw" | "se";
type Point = { x: number; y: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The box with these two opposite corners. */
export function boxFromPoints(a: Point, b: Point): Box {
  const x = clamp01(Math.min(a.x, b.x));
  const y = clamp01(Math.min(a.y, b.y));
  return { x, y, w: clamp01(Math.max(a.x, b.x)) - x, h: clamp01(Math.max(a.y, b.y)) - y };
}

/** The box after its `corner` is dragged to `to`; the opposite corner stays put. */
export function dragCorner(box: Box, corner: Corner, to: Point): Box {
  const fixed = {
    x: corner.endsWith("w") ? box.x + box.w : box.x,
    y: corner.startsWith("n") ? box.y + box.h : box.y,
  };
  return boxFromPoints(fixed, to);
}

/** The box moved by (dx, dy), kept whole inside the photo. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  return {
    ...box,
    x: Math.min(1 - box.w, Math.max(0, box.x + dx)),
    y: Math.min(1 - box.h, Math.max(0, box.y + dy)),
  };
}

type Drag =
  | { kind: "corner"; corner: Corner }
  | { kind: "move"; from: Point; start: Box }
  | { kind: "draw"; from: Point };

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

/**
 * One photo with one box on it. With no starting box the student draws one by
 * dragging across the photo. Done is enabled once the box is large enough.
 */
export function RegionEditor({
  photoUrl,
  photoLabel,
  initial,
  onDone,
  onCancel,
  doneLabel = "Done",
}: {
  photoUrl: string;
  photoLabel: string;
  initial: Box | null;
  onDone: (box: Box) => void;
  onCancel: () => void;
  doneLabel?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<Box | null>(initial);

  function pointOf(event: React.PointerEvent): Point {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function start(event: React.PointerEvent, next: Drag) {
    event.preventDefault();
    event.stopPropagation();
    drag.current = next;
    try {
      // Keeps the moves coming when the finger leaves the photo.
      frame.current?.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; the drag still follows the moves that arrive.
    }
  }

  function onMove(event: React.PointerEvent) {
    const current = drag.current;
    if (!current) return;
    const point = pointOf(event);
    if (current.kind === "draw") setBox(boxFromPoints(current.from, point));
    else if (current.kind === "move")
      setBox(moveBox(current.start, point.x - current.from.x, point.y - current.from.y));
    else setBox((b) => (b ? dragCorner(b, current.corner, point) : b));
  }

  function onEnd(event: React.PointerEvent) {
    if (frame.current?.hasPointerCapture(event.pointerId))
      frame.current.releasePointerCapture(event.pointerId);
    drag.current = null;
  }

  const usable = box ? clampBox(box) : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {box
          ? "Drag the corners to fit the box around the working, or drag inside it to move it."
          : "Drag across the photo to draw a box around the working."}
      </p>
      <div className="flex justify-center">
        <div
          ref={frame}
          data-testid="region-frame"
          className="relative inline-block max-w-full touch-none select-none"
          onPointerDown={(event) => {
            if (!box) start(event, { kind: "draw", from: pointOf(event) });
          }}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
        >
          {/* A local photo the student has just chosen (an object URL). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl}
            alt={photoLabel}
            draggable={false}
            className="block max-h-[70vh] max-w-full rounded-md border"
          />
          {box ? (
            <div
              data-testid="region-box"
              className="border-primary bg-primary/10 absolute cursor-move border-2"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
              onPointerDown={(event) =>
                start(event, { kind: "move", from: pointOf(event), start: box })
              }
            >
              {CORNERS.map((corner) => (
                <span
                  key={corner}
                  role="presentation"
                  data-corner={corner}
                  onPointerDown={(event) => start(event, { kind: "corner", corner })}
                  className={cn(
                    // A large target (44 px) around a small visible handle.
                    "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
                    corner.startsWith("n") ? "top-0" : "top-full",
                    corner.endsWith("w") ? "left-0" : "left-full",
                    corner === "nw" || corner === "se"
                      ? "cursor-nwse-resize"
                      : "cursor-nesw-resize",
                  )}
                >
                  <span className="bg-background border-primary block size-5 rounded-full border-2 shadow" />
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!usable} onClick={() => usable && onDone(usable)}>
          {doneLabel}
        </Button>
        {box && !initial ? (
          <Button type="button" variant="outline" onClick={() => setBox(null)}>
            Draw again
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
