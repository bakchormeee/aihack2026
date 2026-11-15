import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RegionEditor, boxFromPoints, dragCorner, moveBox } from "./region-editor";

const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };

describe("region editor geometry", () => {
  it("makes a box from two corners in any order, inside the photo", () => {
    expect(boxFromPoints({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 })).toEqual({
      x: 0.2,
      y: 0.3,
      w: 0.39999999999999997,
      h: 0.2,
    });
    expect(boxFromPoints({ x: -0.5, y: 0.5 }, { x: 1.5, y: 2 })).toEqual({
      x: 0,
      y: 0.5,
      w: 1,
      h: 0.5,
    });
  });

  it("drags one corner and keeps the opposite one fixed", () => {
    const se = dragCorner(box, "se", { x: 0.9, y: 0.9 });
    expect(se.x).toBeCloseTo(0.2);
    expect(se.y).toBeCloseTo(0.3);
    expect(se.w).toBeCloseTo(0.7);
    expect(se.h).toBeCloseTo(0.6);

    const nw = dragCorner(box, "nw", { x: 0.1, y: 0.1 });
    expect(nw.x).toBeCloseTo(0.1);
    expect(nw.y).toBeCloseTo(0.1);
    expect(nw.x + nw.w).toBeCloseTo(0.6);
    expect(nw.y + nw.h).toBeCloseTo(0.5);

    // Dragging a corner past the opposite one flips the box instead of breaking it.
    const ne = dragCorner(box, "ne", { x: 0.1, y: 0.9 });
    expect(ne.x).toBeCloseTo(0.1);
    expect(ne.w).toBeCloseTo(0.1);
    expect(ne.y).toBeCloseTo(0.5);
    expect(ne.h).toBeCloseTo(0.4);

    const sw = dragCorner(box, "sw", { x: 0, y: 0.6 });
    expect(sw.x).toBe(0);
    expect(sw.x + sw.w).toBeCloseTo(0.6);
    expect(sw.y).toBeCloseTo(0.3);
    expect(sw.h).toBeCloseTo(0.3);
  });

  it("moves a box but keeps it whole inside the photo", () => {
    expect(moveBox(box, 0.1, -0.1)).toEqual({
      ...box,
      x: 0.30000000000000004,
      y: 0.19999999999999998,
    });
    expect(moveBox(box, 1, 1)).toEqual({ ...box, x: 0.6, y: 0.8 });
    expect(moveBox(box, -1, -1)).toEqual({ ...box, x: 0, y: 0 });
  });
});

describe("RegionEditor", () => {
  it("shows the box with four corner handles when adjusting", () => {
    const html = renderToStaticMarkup(
      <RegionEditor
        photoUrl="blob:x"
        photoLabel="Photo 1"
        initial={box}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html.match(/data-corner=/g)).toHaveLength(4);
    expect(html).toContain("left:20%");
    expect(html).toContain("Drag the corners");
  });

  it("asks the student to draw when there is no box yet, with Done disabled", () => {
    const html = renderToStaticMarkup(
      <RegionEditor
        photoUrl="blob:x"
        photoLabel="Photo 1"
        initial={null}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).not.toContain("data-corner");
    expect(html).toContain("Drag across the photo");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Done<\/button>/);
  });
});
