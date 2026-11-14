import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { summariseSheet, summariseSheetSchema } from "./summarise-sheet";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

const valid = fixture("summariseSheet");
const items = [
  {
    label: "1",
    topics: ["Product rule"],
    outcome: "full" as const,
    hintLevel: 0 as const,
    errorType: null,
    feedback: String.raw`Correct: $f'(x) = 2x \sin x + x^2 \cos x$.`,
  },
  {
    label: "2",
    topics: ["Integration by parts"],
    outcome: "partial" as const,
    hintLevel: 2 as const,
    errorType: "algebra_slip" as const,
    feedback: String.raw`An antiderivative of $\sin x$ is $-\cos x$.`,
  },
  {
    label: "3",
    topics: ["Eigenvalues and eigenvectors", "Determinants"],
    outcome: "stuck" as const,
    hintLevel: 3 as const,
    errorType: "incomplete" as const,
    feedback: "You found the eigenvalues but not the eigenvectors.",
  },
];

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("summariseSheet fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = summariseSheetSchema.parse(valid);

    expect(parsed.wasHard[0]).toContain("\\int \\sin x \\, dx");
    expect(fixtureText("summariseSheet")).toContain("\\\\lambda");
  });

  it("rejects the invalid fixture", () => {
    expect(summariseSheetSchema.safeParse(fixture("summariseSheet.invalid")).success).toBe(false);
  });

  it("allows an empty list but not an empty item", () => {
    const summary = { wentWell: [], wasHard: [], nextSteps: ["Redo question 3."] };

    expect(summariseSheetSchema.safeParse(summary).success).toBe(true);
    expect(summariseSheetSchema.safeParse({ ...summary, wentWell: [" "] }).success).toBe(false);
  });
});

describe("summariseSheet", () => {
  it("returns the three lists in the contract shape", async () => {
    fakeAi(valid);

    const result = await summariseSheet({ items });

    expect(result).toEqual(valid);
    expect(Object.keys(result).sort()).toEqual(["nextSteps", "wasHard", "wentWell"]);
  });

  it("sends every question with its topics, outcome, hint level, error type and feedback", async () => {
    const create = fakeAi(valid);

    await summariseSheet({ items });

    const text = sentText(create);
    for (const item of items) {
      expect(text).toContain(item.feedback);
      for (const topic of item.topics) expect(text).toContain(topic);
    }
    expect(text).toMatch(/Question 2[\s\S]*partial[\s\S]*algebra_slip/);
    expect(text).toMatch(/Question 3[\s\S]*stuck[\s\S]*incomplete/);
    expect(text).toMatch(/hints? (used|revealed)[^\n]*2/i);
    expect(text).not.toContain("null");
    expect(sentSystem(create)).toContain("$…$");
    expect(sentSystem(create)).toContain("$$…$$");
  });

  it("makes no request for a sheet with no marked questions", async () => {
    const create = fakeAi();

    await expect(summariseSheet({ items: [] })).resolves.toEqual({
      wentWell: [],
      wasHard: [],
      nextSteps: [],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("summariseSheet.invalid"), fixture("summariseSheet.invalid"));

    await expect(summariseSheet({ items })).rejects.toBeInstanceOf(AiOutputError);
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    await expect(summariseSheet({ items })).resolves.toEqual(valid);
  });
});
