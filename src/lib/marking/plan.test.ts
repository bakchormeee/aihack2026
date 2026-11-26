import { describe, expect, it } from "vitest";

import { markingPlan, parseSwitch } from "./plan";

describe("markingPlan", () => {
  it("marks against the official solution when there is one, whatever the switch says", () => {
    expect(markingPlan({ hasOfficial: true, markWithAi: true })).toBe("official");
    expect(markingPlan({ hasOfficial: true, markWithAi: false })).toBe("official");
  });

  it("marks with the AI when the switch is on and there is no official solution", () => {
    expect(markingPlan({ hasOfficial: false, markWithAi: true })).toBe("ai");
  });

  it("waits when the switch is off and there is no official solution", () => {
    expect(markingPlan({ hasOfficial: false, markWithAi: false })).toBe("wait");
  });
});

describe("parseSwitch", () => {
  it("reads the positions a form or a caller can send", () => {
    for (const on of [true, "true", "on"]) expect(parseSwitch(on)).toBe(true);
    for (const off of [false, "false", "off"]) expect(parseSwitch(off)).toBe(false);
  });

  it("is undefined when the switch was not sent, so the sheet's position is used", () => {
    for (const none of [undefined, null, "", "maybe", 1]) expect(parseSwitch(none)).toBeUndefined();
  });
});
