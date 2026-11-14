import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { generateHints, generateHintsSchema, hintsLeakAnswer } from "./generate-hints";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

type Raw = { hint1: string; hint2: string; hint3: string; solution: string; finalAnswer: string };
const valid = fixture("generateHints") as Raw;
const leak = fixture("generateHints.leak") as Raw;
const questionBody = String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.`;

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("hintsLeakAnswer", () => {
  it("is false when no hint contains the answer", () => {
    expect(hintsLeakAnswer([valid.hint1, valid.hint2], valid.finalAnswer)).toBe(false);
  });

  it("is true when a hint states the value of the answer", () => {
    expect(hintsLeakAnswer([leak.hint1, leak.hint2], leak.finalAnswer)).toBe(true);
  });

  it("ignores differences in spacing, delimiters and fraction commands", () => {
    expect(hintsLeakAnswer(["You should reach $x=3$ in the end."], "$x = 3$")).toBe(true);
    expect(
      hintsLeakAnswer([String.raw`The angle is $\dfrac{\pi}{4}$.`], String.raw`$$\frac{\pi}{4}$$`),
    ).toBe(true);
    expect(hintsLeakAnswer([String.raw`so $\left( x + 1 \right)^2$`], String.raw`$(x+1)^2$`)).toBe(
      true,
    );
  });

  it("finds the value on the right of an equals sign", () => {
    expect(hintsLeakAnswer(["The limit equals 12."], "$L = 12$")).toBe(true);
    expect(hintsLeakAnswer(["There are 120 cases."], "$L = 12$")).toBe(false);
  });

  it("does not match a short answer inside a longer expression", () => {
    expect(hintsLeakAnswer(["Differentiate $x^2$ first."], "$2$")).toBe(false);
    expect(hintsLeakAnswer([String.raw`Note that $\frac{1}{2}$ appears.`], "2")).toBe(false);
    expect(hintsLeakAnswer(["Expand $2x + 1$."], "2")).toBe(false);
    expect(hintsLeakAnswer(["Consider $x = -2$."], "2")).toBe(false);
    expect(hintsLeakAnswer(["The answer is 2."], "$2$")).toBe(true);
  });

  it("checks each part of an answer with several parts", () => {
    expect(hintsLeakAnswer(["One root is $x = 3$."], "$x = 1$ or $x = 3$")).toBe(true);
    expect(hintsLeakAnswer(["Factorise the quadratic in $x$."], "$x = 1$ or $x = 3$")).toBe(false);
  });

  it("is false for an empty answer or no hints", () => {
    expect(hintsLeakAnswer([valid.hint1], "")).toBe(false);
    expect(hintsLeakAnswer([valid.hint1], " $ $ ")).toBe(false);
    expect(hintsLeakAnswer([], "$2$")).toBe(false);
  });
});

describe("generateHints fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    expect(generateHintsSchema.safeParse(valid).success).toBe(true);
    expect(valid.hint2).toContain("\\int u \\, dv");
    expect(fixtureText("generateHints")).toContain("\\\\int");
  });

  it("accepts the leaking fixture as well formed", () => {
    expect(generateHintsSchema.safeParse(leak).success).toBe(true);
  });

  it("rejects the invalid fixture", () => {
    expect(generateHintsSchema.safeParse(fixture("generateHints.invalid")).success).toBe(false);
  });
});

describe("generateHints", () => {
  it("returns three hints, the solution and the final answer", async () => {
    const create = fakeAi(valid);

    const result = await generateHints({ questionBody });

    expect(result).toEqual({
      hints: [valid.hint1, valid.hint2, valid.hint3],
      solution: valid.solution,
      finalAnswer: valid.finalAnswer,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends the question, the three hint levels and the LaTeX rules", async () => {
    const create = fakeAi(valid);

    await generateHints({ questionBody });

    expect(sentText(create)).toContain(questionBody);
    const system = sentSystem(create);
    expect(system).toContain("$…$");
    expect(system).toContain("$$…$$");
    expect(system).toMatch(/hint1[^\n]*concept/i);
    expect(system).toMatch(/hint2[^\n]*first step/i);
    expect(system).toMatch(/hint3[^\n]*outline/i);
    expect(system).toMatch(/must not (contain|state|reveal)[^\n]*final answer/i);
  });

  it("regenerates once when hint 1 or 2 leaks the final answer", async () => {
    const create = fakeAi(leak, valid);

    const result = await generateHints({ questionBody });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.hints).toEqual([valid.hint1, valid.hint2, valid.hint3]);
    expect(sentText(create, 1)).toContain(questionBody);
    expect(sentText(create, 1)).toMatch(/final answer/i);
  });

  it("does not regenerate when only hint 3 contains the answer", async () => {
    const create = fakeAi({ ...valid, hint3: `${valid.hint3}\n\nYou should get $-2$.` });

    await generateHints({ questionBody });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("regenerates only once, even when the second set leaks too", async () => {
    const create = fakeAi(leak, leak);

    const result = await generateHints({ questionBody });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.hints[1]).toBe(leak.hint2);
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("generateHints.invalid"), fixture("generateHints.invalid"));

    await expect(generateHints({ questionBody })).rejects.toBeInstanceOf(AiOutputError);
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await generateHints({ questionBody });

    expect(result.hints).toEqual([valid.hint1, valid.hint2, valid.hint3]);
    expect(result.finalAnswer).toBe(valid.finalAnswer);
  });
});
