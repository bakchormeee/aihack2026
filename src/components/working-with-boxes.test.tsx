import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Mistake } from "@/lib/domain";

import { WorkingWithBoxes } from "./working-with-boxes";

const text = "Start $x^2 = 4$ so $x = 3$ done";
const slip: Mistake = {
  type: "algebra_slip",
  quote: "$x = 3$",
  hint: "h1",
  location: { kind: "text" },
};
const gap: Mistake = { type: "method", quote: "Start", hint: "h2", location: { kind: "text" } };
const elsewhere: Mistake = {
  type: "method",
  quote: "not here",
  hint: "h3",
  location: { kind: "text" },
};

describe("WorkingWithBoxes", () => {
  it("boxes each found quote, amber for a slip and red for a structural mistake, numbered like the list", () => {
    const html = renderToStaticMarkup(<WorkingWithBoxes text={text} mistakes={[gap, slip]} />);

    expect(html.match(/data-mistake="1"/g)).toHaveLength(1);
    expect(html.match(/data-mistake="2"/g)).toHaveLength(1);
    expect(html).toMatch(/data-mistake="1"[^>]*data-severity="structural"/);
    expect(html).toMatch(/data-mistake="2"[^>]*data-severity="careless"/);
  });

  it("still renders the maths in the working", () => {
    const html = renderToStaticMarkup(<WorkingWithBoxes text={text} mistakes={[slip]} />);

    expect(html).toContain('class="katex"');
    expect(html).not.toContain("$x");
  });

  it("leaves a quote that is not in the working out of the text", () => {
    const html = renderToStaticMarkup(<WorkingWithBoxes text={text} mistakes={[elsewhere]} />);

    expect(html).not.toContain("data-mistake");
  });

  it("ignores mistakes that are in a photo or a PDF", () => {
    const photo: Mistake = {
      ...slip,
      location: { kind: "image", fileIndex: 0, box: { x: 0, y: 0, width: 0.5, height: 0.5 } },
    };

    expect(renderToStaticMarkup(<WorkingWithBoxes text={text} mistakes={[photo]} />)).not.toContain(
      "data-mistake",
    );
  });

  it("shows plain working with no boxes for an old mark", () => {
    const html = renderToStaticMarkup(<WorkingWithBoxes text={text} mistakes={[]} />);

    expect(html).toContain("Start");
    expect(html).not.toContain("data-mistake");
  });

  it("uses the numbers it is given, and leaves an unnumbered mistake unboxed", () => {
    const html = renderToStaticMarkup(
      <WorkingWithBoxes text={text} mistakes={[gap, slip]} numbers={[null, 1]} />,
    );

    expect(html).toContain('data-mistake="1"');
    expect(html).not.toContain('data-mistake="2"');
    expect(html).toMatch(/data-mistake="1"[^>]*data-severity="careless"/);
    expect(html).toContain("Start"); // the text is still there, unboxed
  });
});
