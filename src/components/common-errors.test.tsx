import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommonErrors, type CommonError } from "./common-errors";

const hide = async () => {};
const one: CommonError = {
  id: "m1",
  description: "Drops the minus sign when removing a bracket, e.g. $3-(2+8)$ as $3-2+8$.",
  timesSeen: 3,
  lastSeen: "2026-11-10T09:00:00.000Z",
  example: "$3-(2+8) = 3-2+8$",
};

describe("CommonErrors", () => {
  it("shows each misconception with times seen, last seen, the student's own words and a Not me button", () => {
    const html = renderToStaticMarkup(
      <CommonErrors errors={[one]} updating={false} hideAction={hide} />,
    );

    expect(html).toContain("Drops the minus sign");
    expect(html).toContain('class="katex"'); // the maths renders
    expect(html).toContain("Seen 3 times");
    expect(html).toContain("10 Nov 2026");
    expect(html).toContain("Your working:");
    expect(html).toContain("Not me");
  });

  it("says seen once in the singular", () => {
    const html = renderToStaticMarkup(
      <CommonErrors errors={[{ ...one, timesSeen: 1 }]} updating={false} hideAction={hide} />,
    );

    expect(html).toContain("Seen once");
  });

  it("explains where the list comes from when it is empty", () => {
    const html = renderToStaticMarkup(
      <CommonErrors errors={[]} updating={false} hideAction={hide} />,
    );

    expect(html).toContain("built from the mistakes in your marked answers");
    expect(html).not.toContain("Not me");
  });

  it("says the list is being updated", () => {
    const html = renderToStaticMarkup(<CommonErrors errors={[one]} updating hideAction={hide} />);

    expect(html).toContain("Updating your common errors");
  });
});
