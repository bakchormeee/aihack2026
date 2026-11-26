import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BAND_LEGEND } from "@/lib/mastery/band";

import { TopicList, toggleOpen, type TopicRow } from "./topic-list";

const topic = (over: Partial<TopicRow> & Pick<TopicRow, "id" | "name">): TopicRow => ({
  mastery: null,
  attempts: 0,
  longFormAttempts: 0,
  prereqs: [],
  ...over,
});

const topics: TopicRow[] = [
  topic({ id: "t-none-z", name: "Zeta functions" }),
  topic({ id: "t-solid", name: "Chain rule", mastery: 0.82, attempts: 5, longFormAttempts: 5 }),
  topic({
    id: "t-weak",
    name: "Product rule",
    mastery: 0.32,
    attempts: 6,
    longFormAttempts: 4,
    prereqs: ["Differentiation basics"],
  }),
  topic({ id: "t-none-a", name: "Alpha limits" }),
  topic({
    id: "t-early",
    name: "Integration by parts",
    mastery: 0.2,
    attempts: 2,
    longFormAttempts: 2,
  }),
  topic({ id: "t-mid", name: "Substitution", mastery: 0.7, attempts: 3, longFormAttempts: 3 }),
];

const render = (props: Partial<React.ComponentProps<typeof TopicList>> = {}) =>
  renderToStaticMarkup(<TopicList courseId="c1" topics={topics} {...props} />);

const names = (html: string) => [...html.matchAll(/data-topic-name="([^"]+)"/g)].map((m) => m[1]);

describe("TopicList order", () => {
  it("lists the weakest first and the topics with no marks last, by name", () => {
    expect(names(render())).toEqual([
      "Integration by parts",
      "Product rule",
      "Substitution",
      "Chain rule",
      "Alpha limits",
      "Zeta functions",
    ]);
  });
});

describe("TopicList labels", () => {
  it("shows one word label per topic, by the band rules", () => {
    const html = render();
    const label = (name: string) =>
      html.match(new RegExp(`data-topic-name="${name}"[\\s\\S]*?data-band="([a-z_]+)"`))?.[1];

    expect(label("Product rule")).toBe("needs_work");
    expect(label("Substitution")).toBe("getting_there"); // 0.70 exactly, 3 attempts
    expect(label("Chain rule")).toBe("solid");
    expect(label("Integration by parts")).toBe("too_early"); // 2 long-form attempts
    expect(label("Alpha limits")).toBe("too_early");
    expect(html).toContain("Needs work");
    expect(html).toContain("Getting there");
    expect(html).toContain("Solid");
    expect(html).toContain("Too early to tell");
  });

  it("counts only long-form attempts for the label, not the spot-the-error ones", () => {
    const html = render({
      topics: [topic({ id: "x", name: "X", mastery: 0.9, attempts: 6, longFormAttempts: 1 })],
    });

    expect(html).toContain("Too early to tell");
    expect(html).not.toContain(">Solid<");
  });

  it("shows no percentage, bar or meter on a closed row", () => {
    const html = render();

    // The percentage is only in screen-reader text (the tooltip's text), never visible.
    const visible = html
      .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
      .replace(BAND_LEGEND, ""); // the legend names the cut-offs, not a topic's mastery
    expect(visible).not.toMatch(/\d+%/);
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("<canvas");
  });

  it("gives screen readers the same text as the tooltip", () => {
    const html = render();

    expect(html).toContain("Mastery 32% · 6 attempts");
    expect(html).toContain("Mastery 82% · 5 attempts");
    expect(html).toContain("No marked attempts yet");
  });

  it("puts the one-line legend under the list", () => {
    const html = render();

    expect(html).toContain(BAND_LEGEND);
    expect(html.indexOf(BAND_LEGEND)).toBeGreaterThan(html.lastIndexOf("data-topic-name"));
  });
});

describe("TopicList rows", () => {
  it("makes each row a real button that says whether it is open", () => {
    const html = render({ defaultOpenId: "t-weak" });

    expect(html.match(/<button[^>]*aria-expanded="false"/g)).toHaveLength(5);
    expect(html.match(/<button[^>]*aria-expanded="true"/g)).toHaveLength(1);
    expect(html).not.toContain('tabindex="-1"');
  });

  it("opens nothing at first", () => {
    const html = render();

    expect(html).not.toContain("Revise");
    expect(html).not.toContain("See mistakes");
  });

  it("shows the percentage line, the prerequisites and the three actions in the open row only", () => {
    const html = render({ defaultOpenId: "t-weak" });

    expect(html).toContain("Needs: Differentiation basics");
    expect(html).toContain('href="/revise?course=c1&amp;topic=t-weak"');
    expect(html).toContain('href="/revise?course=c1&amp;topic=t-weak&amp;mode=spot_error"');
    expect(html).toContain('href="/courses/c1/mistakes?topic=t-weak"');
    expect(html.match(/>Revise</g)).toHaveLength(1);
    expect(html.match(/>Spot the error</g)).toHaveLength(1);
    expect(html.match(/>See mistakes</g)).toHaveLength(1);
    // The line is visible once in the open row; the closed rows keep theirs for screen readers.
    expect(html.match(/Mastery 32% · 6 attempts/g)).toHaveLength(1);
    expect(html).not.toContain('topic=t-solid"');
  });

  it("leaves out the prerequisites line when the topic has none", () => {
    const html = render({ defaultOpenId: "t-solid" });

    expect(html).not.toContain("Needs:");
    expect(html).toContain(">Revise<");
  });

  it("lists several prerequisites with commas", () => {
    const html = render({
      topics: [topic({ id: "p", name: "P", prereqs: ["A", "B"] })],
      defaultOpenId: "p",
    });

    expect(html).toContain("Needs: A, B");
  });

  it("says there are no marked attempts in an open row with no mastery", () => {
    const html = render({ defaultOpenId: "t-none-a" });

    expect(html).toContain("No marked attempts yet");
  });

  it("ignores an unknown default open row", () => {
    expect(render({ defaultOpenId: "nope" })).not.toContain("See mistakes");
  });

  it("renders nothing but the legend for no topics", () => {
    const html = render({ topics: [] });

    expect(html).not.toContain("<button");
  });
});

describe("toggleOpen", () => {
  it("opens a row when none is open", () => {
    expect(toggleOpen(null, "a")).toBe("a");
  });

  it("closes the open row when it is chosen again", () => {
    expect(toggleOpen("a", "a")).toBeNull();
  });

  it("opens another row and so closes the first", () => {
    expect(toggleOpen("a", "b")).toBe("b");
  });
});
