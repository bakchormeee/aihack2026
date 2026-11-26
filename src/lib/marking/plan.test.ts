import { describe, expect, it } from "vitest";

import { markingPlan, parseSwitch, switchView } from "./plan";

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

describe("switchView", () => {
  it("says the AI marks in about a minute when on", () => {
    expect(switchView({ checked: true, total: 1, official: 0 })).toEqual({
      locked: false,
      text: "The AI marks it in about a minute.",
      scope: null,
    });
  });
  it("says it waits for the official solutions when off", () => {
    expect(switchView({ checked: false, total: 3, official: 0 }).text).toBe(
      "Not marked until the official solutions are uploaded.",
    );
  });
  it("is locked when every question has an official solution, whatever its position", () => {
    for (const checked of [true, false]) {
      expect(switchView({ checked, total: 2, official: 2 })).toEqual({
        locked: true,
        text: "Marked against the official solution",
        scope: null,
      });
    }
  });
  it("stays usable and says how many it applies to when only some have official solutions", () => {
    const view = switchView({ checked: false, total: 4, official: 1 });
    expect(view.locked).toBe(false);
    expect(view.scope).toBe("Applies to 3 of 4 questions");
  });
  it("is not locked with nothing to submit", () => {
    expect(switchView({ checked: true, total: 0, official: 0 }).locked).toBe(false);
  });
});
