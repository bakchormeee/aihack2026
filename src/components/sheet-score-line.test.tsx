import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SheetScoreLine } from "./sheet-score-line";

describe("SheetScoreLine", () => {
  it("shows the marks, the percentage and the attempted count", () => {
    const html = renderToStaticMarkup(
      <SheetScoreLine score={{ attempted: 5, total: 9, points: 17, max: 25, percent: 68 }} />,
    );
    expect(html).toContain("17 / 25");
    expect(html).toContain("68% · attempted 5 of 9 questions");
  });

  it("says there are no marks yet", () => {
    const html = renderToStaticMarkup(
      <SheetScoreLine score={{ attempted: 0, total: 9, points: 0, max: 0, percent: null }} />,
    );
    expect(html).toContain("Attempted 0 of 9 questions · no marks yet");
  });

  it("shows nothing for a sheet with no questions", () => {
    const html = renderToStaticMarkup(
      <SheetScoreLine score={{ attempted: 0, total: 0, points: 0, max: 0, percent: null }} />,
    );
    expect(html).toBe("");
  });
});
