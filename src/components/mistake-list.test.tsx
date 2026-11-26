import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Mistake } from "@/lib/domain";

import { MarkingScheme, MistakeList } from "./mistake-list";

const mistakes: Mistake[] = [
  {
    type: "algebra_slip",
    quote: "$-\\cos x$",
    hint: "Check the sign.",
    location: { kind: "text" },
  },
  {
    type: "method",
    quote: "so $x=2$",
    hint: "Is that case enough?",
    location: { kind: "pdf", fileIndex: 0, page: 2 },
  },
  {
    type: "notation",
    quote: "$a_n$",
    hint: "Check the bracket.",
    location: { kind: "image", fileIndex: 1, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
  },
];

describe("MistakeList", () => {
  it("numbers each mistake with its severity, kind, quote and hint", () => {
    const html = renderToStaticMarkup(<MistakeList mistakes={mistakes} />);

    expect(html).toContain("Careless slip");
    expect(html).toContain("Structural mistake");
    expect(html).toContain("Algebra or sign slip");
    expect(html).toContain("Check the sign.");
    expect(html).toContain('class="katex"'); // the quote's maths renders
    expect(html.indexOf("Check the sign.")).toBeLessThan(html.indexOf("Is that case enough?"));
    expect(html).toContain(">1<");
    expect(html).toContain(">3<");
  });

  it("says where a mistake is in a PDF or a photo", () => {
    const html = renderToStaticMarkup(<MistakeList mistakes={mistakes} />);

    expect(html).toContain("Page 2");
    expect(html).toContain("Photo 2");
  });

  it("lists a mistake with no place on the working without a number", () => {
    const html = renderToStaticMarkup(<MistakeList mistakes={mistakes} numbers={[null, 1, 2]} />);

    // Notes that have a number can be matched to their box; the bare one cannot.
    expect(html.match(/data-note="/g)).toHaveLength(2);
    expect(html).toContain('data-note="1"');
    expect(html).toContain('data-note="2"');
    expect(html).not.toContain('data-note="3"');
    expect(html).toContain("Check the sign."); // still listed
    expect(html).toContain("–");
  });

  it("shows nothing for an empty list", () => {
    expect(renderToStaticMarkup(<MistakeList mistakes={[]} />)).toBe("");
  });
});

describe("MarkingScheme", () => {
  it("lists 5 down to 0 and highlights the current score", () => {
    const html = renderToStaticMarkup(<MarkingScheme score={4} />);

    for (const n of [5, 4, 3, 2, 1, 0]) expect(html).toContain(`>${n}<`);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*><span[^>]*>4</);
  });
});
