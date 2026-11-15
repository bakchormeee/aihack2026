import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "@/lib/ai/client";
import { fakeAi, fixture, sentSystem, sentText } from "@/lib/ai/test-helpers";

import {
  bracesBalanced,
  writeDemoWorking,
  writeDemoWorkingSchema,
} from "../../scripts/demo/write-demo-working";

const good = fixture("writeDemoWorking") as { working: string };
const request = {
  questionBody: "Find every real $x$ with $\\frac{1}{x - 2} < 3$.",
  outcome: "partial" as const,
  misconception:
    "Keeps the inequality's direction after multiplying by a quantity that can be negative.",
  hintsSeen: ["Think about the sign of $x - 2$.", "Split into the cases $x > 2$ and $x < 2$."],
};

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("writeDemoWorking schema", () => {
  const ok = (working: string) => writeDemoWorkingSchema.safeParse({ working }).success;

  it("accepts the fixture and rejects the invalid one", () => {
    expect(ok(good.working)).toBe(true);
    expect(writeDemoWorkingSchema.safeParse(fixture("writeDemoWorking.invalid")).success).toBe(
      false,
    );
  });

  it("rejects maths outside dollars, an unclosed dollar, unbalanced braces, or empty text", () => {
    expect(ok("So x^2 > 4.")).toBe(false);
    expect(ok("So $x > 2.")).toBe(false);
    expect(ok("So $\\frac{1}{2 > x$.")).toBe(false);
    expect(ok("   ")).toBe(false);
  });

  it("rejects working longer than the app accepts", () => {
    expect(ok("a".repeat(20_001))).toBe(false);
  });
});

describe("bracesBalanced", () => {
  it.each([
    ["$\\frac{1}{2}$", true],
    ["$\\{x : x > 0\\}$", true],
    ["$\\frac{1}{2$", false],
    ["$x}$ and ${y$", false],
    ["no maths {here", true],
  ])("%s → %s", (text, expected) => {
    expect(bracesBalanced(text)).toBe(expected);
  });
});

describe("writeDemoWorking", () => {
  it("returns the typed working", async () => {
    fakeAi(good);
    expect(await writeDemoWorking(request)).toBe(good.working);
  });

  it("sends the question, the outcome, the mistake and the hints seen", async () => {
    const create = fakeAi(good);
    await writeDemoWorking(request);

    const text = sentText(create);
    expect(text).toContain(request.questionBody);
    expect(text).toContain("Target outcome: partial");
    expect(text).toContain(request.misconception);
    expect(text).toContain("Hint 1: Think about the sign of $x - 2$.");
    expect(text).toContain("Hint 2: Split into the cases");
  });

  it("asks for a complete correct answer with no mistake for a full attempt, and says when no hint was seen", async () => {
    const create = fakeAi(good);
    await writeDemoWorking({ ...request, outcome: "full", misconception: null, hintsSeen: [] });

    const text = sentText(create);
    expect(text).toContain("Target outcome: full");
    expect(text).toContain("Mistake to show: none");
    expect(text).toContain("Hints seen: none");
  });

  it("tells the model to write as a student types, with LaTeX, and never to name the mistake", async () => {
    const create = fakeAi(good);
    await writeDemoWorking(request);

    const system = sentSystem(create);
    expect(system).toMatch(/typed/i);
    expect(system).toContain("$…$");
    expect(system).toMatch(/never name the mistake/i);
    expect(system).toMatch(/stuck/);
  });

  it("asks again when the first reply breaks the schema, then throws if it still does", async () => {
    const bad = fixture("writeDemoWorking.invalid");
    const create = fakeAi(bad, good);
    expect(await writeDemoWorking(request)).toBe(good.working);
    expect(create).toHaveBeenCalledTimes(2);

    fakeAi(bad, bad);
    await expect(writeDemoWorking(request)).rejects.toBeInstanceOf(AiOutputError);
  });

  it("reads its fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    expect(await writeDemoWorking(request)).toBe(good.working);
  });
});
