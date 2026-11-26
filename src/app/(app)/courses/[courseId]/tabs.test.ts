import { describe, expect, it } from "vitest";

import { isTabActive } from "@/components/tab-nav";

import { courseTabs } from "./tabs";

const base = "/courses/c1";

describe("courseTabs", () => {
  it("lists Sheets, Topics, Mistakes, Progress in that order", () => {
    expect(courseTabs(base).map((t) => t.label)).toEqual([
      "Sheets",
      "Topics",
      "Mistakes",
      "Progress",
    ]);
  });

  it("points Sheets at the course address and Topics at /topics", () => {
    const tabs = courseTabs(base);
    expect(tabs[0].href).toBe(base);
    expect(tabs[1].href).toBe(`${base}/topics`);
  });
});

describe("the selected course tab", () => {
  const selected = (pathname: string) =>
    courseTabs(base)
      .filter((tab) => isTabActive(pathname, tab))
      .map((tab) => tab.label);

  it("selects Sheets on the course address and on the old /sheets address", () => {
    expect(selected(base)).toEqual(["Sheets"]);
    expect(selected(`${base}/sheets`)).toEqual(["Sheets"]);
  });

  it("selects exactly one other tab on each of their addresses", () => {
    expect(selected(`${base}/topics`)).toEqual(["Topics"]);
    expect(selected(`${base}/mistakes`)).toEqual(["Mistakes"]);
    expect(selected(`${base}/progress`)).toEqual(["Progress"]);
  });
});
