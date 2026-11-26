import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkWithAiSwitch } from "./mark-with-ai-switch";

const render = (props: Partial<Parameters<typeof MarkWithAiSwitch>[0]> = {}) =>
  renderToStaticMarkup(
    <MarkWithAiSwitch checked onCheckedChange={() => {}} total={1} official={0} {...props} />,
  );

describe("MarkWithAiSwitch", () => {
  it("is a labelled switch with the on text", () => {
    const html = render();
    expect(html).toContain('role="switch"');
    expect(html).toContain("Mark with AI now");
    expect(html).toContain("The AI marks it in about a minute.");
    expect(html).toContain('aria-checked="true"');
  });

  it("shows the off text when off", () => {
    const html = render({ checked: false });
    expect(html).toContain("Not marked until the official solutions are uploaded.");
    expect(html).toContain('aria-checked="false"');
  });

  it("is disabled and locked when every question has an official solution", () => {
    const html = render({ official: 1 });
    expect(html).toContain("Marked against the official solution");
    expect(html).toMatch(/disabled|data-disabled/);
    expect(html).toContain("<svg");
  });

  it("says how many questions it applies to when only some are official", () => {
    const html = render({ total: 4, official: 1 });
    expect(html).toContain("Applies to 3 of 4 questions");
    expect(html).not.toContain("Marked against the official solution");
  });
});
