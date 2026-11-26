import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Mistake } from "@/lib/domain";

import { PhotoWithBoxes } from "./photo-with-boxes";

const onPhoto = (fileIndex: number, type: Mistake["type"] = "method"): Mistake => ({
  type,
  quote: "q",
  hint: "h",
  location: { kind: "image", fileIndex, box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } },
});
const typed: Mistake = { type: "method", quote: "q", hint: "h", location: { kind: "text" } };

describe("PhotoWithBoxes", () => {
  it("draws a numbered box for each mistake on this photo, numbered as in the list", () => {
    const mistakes = [typed, onPhoto(0, "algebra_slip"), onPhoto(1), onPhoto(0)];

    const html = renderToStaticMarkup(
      <PhotoWithBoxes src="/api/files/submission/f1" fileIndex={0} mistakes={mistakes} />,
    );

    expect(html.match(/data-mistake="/g)).toHaveLength(2);
    expect(html).toContain('data-mistake="2"');
    expect(html).toContain('data-mistake="4"');
    expect(html).not.toContain('data-mistake="3"');
    expect(html).toMatch(/data-mistake="2"[^>]*data-severity="careless"/);
    expect(html).toContain("left:");
  });

  it("says the boxes are approximate", () => {
    const html = renderToStaticMarkup(
      <PhotoWithBoxes src="/x" fileIndex={0} mistakes={[onPhoto(0)]} />,
    );

    expect(html.toLowerCase()).toContain("approximate");
  });

  it("shows the photo with no label when nothing is boxed on it", () => {
    const html = renderToStaticMarkup(
      <PhotoWithBoxes src="/x" fileIndex={0} mistakes={[onPhoto(1)]} />,
    );

    expect(html).toContain('src="/x"');
    expect(html.toLowerCase()).not.toContain("approximate");
  });

  it("uses the numbers it is given and draws no box for a mistake with none", () => {
    const html = renderToStaticMarkup(
      <PhotoWithBoxes
        src="/x"
        fileIndex={0}
        mistakes={[typed, onPhoto(0), onPhoto(0)]}
        numbers={[null, 1, null]}
      />,
    );

    expect(html.match(/data-mistake="/g)).toHaveLength(1);
    expect(html).toContain('data-mistake="1"');
    expect(html).toContain('id="mistake-box-1"');
  });
});
