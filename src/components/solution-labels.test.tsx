import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SideBySide } from "./side-by-side";
import { SolutionPanel } from "./solution-panel";

const official = { basis: "official" as const, body: "Official steps" };
const ai = { basis: "ai" as const, body: "AI steps" };

describe("solution labels", () => {
  it("the question page's panel says which solution it shows", () => {
    expect(renderToStaticMarkup(<SolutionPanel solution={official} />)).toContain(
      "Official solution",
    );
    const aiHtml = renderToStaticMarkup(<SolutionPanel solution={ai} />);
    expect(aiHtml).toContain("AI-written solution");
    expect(aiHtml).not.toContain("Official solution");
  });

  it("the Solutions tab's side-by-side view says which solution it shows", () => {
    const side = (solution: typeof official | typeof ai | null) =>
      renderToStaticMarkup(<SideBySide solution={solution} text="x" files={[]} />);
    expect(side(official)).toContain("Official solution");
    expect(side(ai)).toContain("AI-written solution");
    expect(side(null)).toContain("The official solutions do not cover this question.");
  });
});
