import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MasteryOverTime } from "./mastery-over-time";

const topics = [
  {
    id: "a",
    name: "Product rule",
    series: [
      { at: "2026-11-03T10:00:00Z", mastery: 0.2 },
      { at: "2026-11-05T10:00:00Z", mastery: 0.8 },
    ],
  },
  {
    id: "b",
    name: "Chain rule",
    series: [
      { at: "2026-11-03T10:00:00Z", mastery: 0.6 },
      { at: "2026-11-05T10:00:00Z", mastery: 0.5 },
    ],
  },
];

const render = () => renderToStaticMarkup(<MasteryOverTime topics={topics} events={[]} />);

describe("MasteryOverTime bands", () => {
  it("shows no percentage and no points readout", () => {
    const html = render();
    const text = html.replace(/<[^>]*>/g, " "); // what a reader sees, not attributes like width="100%"

    expect(text).not.toMatch(/\d+%/);
    expect(html).not.toContain("pts");
    expect(html).not.toContain("▲");
    expect(html).not.toContain("▼");
  });

  it("describes each topic's move in bands in the table view", () => {
    const html = render();

    expect(html).toContain("Needs work"); // Product rule: first
    expect(html).toContain("Solid"); // Product rule: latest
    expect(html).toContain("Up");
    expect(html).toContain("Same band"); // Chain rule: 0.6 to 0.5, both Getting there
    expect(html).toContain("Getting there");
  });

  it("keeps the empty message when there is nothing marked", () => {
    const html = renderToStaticMarkup(<MasteryOverTime topics={[]} events={[]} />);

    expect(html).toContain("No marked attempts yet");
  });
});
