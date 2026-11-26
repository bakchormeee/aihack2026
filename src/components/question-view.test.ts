import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "" }) }));

import { lockedHintsLine } from "./question-view";

describe("lockedHintsLine", () => {
  it("counts the hints used, with the time when the timer is on", () => {
    expect(lockedHintsLine(2, 760)).toBe("2 hints used · 12:40");
    expect(lockedHintsLine(1, 5)).toBe("1 hint used · 0:05");
  });

  it("says when no hints were used, and leaves the time out when the timer is off", () => {
    expect(lockedHintsLine(0, null)).toBe("No hints used");
    expect(lockedHintsLine(3, null)).toBe("3 hints used");
  });
});
