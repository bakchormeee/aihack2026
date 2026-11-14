import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { hintsLeakAnswer } from "./generate-hints";
import { generateVariant, generateVariantSchema } from "./generate-variant";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

type Raw = {
  body: string;
  solution: string;
  finalAnswer: string;
  hint1: string;
  hint2: string;
  hint3: string;
  expectedMinutes: number;
};
const valid = fixture("generateVariant") as Raw;
const leaking: Raw = { ...valid, hint2: `${valid.hint2} The integral equals $1$.` };
const input = {
  parentBody: String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.`,
  parentSolution: String.raw`By parts, $\big[ x \sin x \big]_0^{\pi} - \int_0^{\pi} \sin x \, dx = -2$.`,
  errorSummary: String.raw`algebra_slip: wrote $\int \sin x \, dx = \cos x$`,
};

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("generateVariant fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = generateVariantSchema.parse(valid);

    expect(parsed.body).toContain("\\sin x \\, dx");
    expect(fixtureText("generateVariant")).toContain("\\\\int");
  });

  it("has a valid fixture whose hints 1 and 2 do not leak the answer", () => {
    expect(hintsLeakAnswer([valid.hint1, valid.hint2], valid.finalAnswer)).toBe(false);
    expect(hintsLeakAnswer([leaking.hint1, leaking.hint2], leaking.finalAnswer)).toBe(true);
  });

  it("rejects the invalid fixture", () => {
    expect(generateVariantSchema.safeParse(fixture("generateVariant.invalid")).success).toBe(false);
  });

  it("accepts only a whole number of minutes above zero", () => {
    const withMinutes = (expectedMinutes: unknown) =>
      generateVariantSchema.safeParse({ ...valid, expectedMinutes }).success;

    expect(withMinutes(1)).toBe(true);
    expect(withMinutes(0)).toBe(false);
    expect(withMinutes(7.5)).toBe(false);
  });
});

describe("generateVariant", () => {
  it("returns the variant in the contract shape", async () => {
    const create = fakeAi(valid);

    const result = await generateVariant(input);

    expect(result).toEqual({
      body: valid.body,
      solution: valid.solution,
      finalAnswer: valid.finalAnswer,
      hints: [valid.hint1, valid.hint2, valid.hint3],
      expectedMinutes: valid.expectedMinutes,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends the parent question, its solution, the student's error and the rules", async () => {
    const create = fakeAi(valid);

    await generateVariant(input);

    const text = sentText(create);
    expect(text).toContain(input.parentBody);
    expect(text).toContain(input.parentSolution);
    expect(text).toContain(input.errorSummary);
    const system = sentSystem(create);
    expect(system).toContain("$…$");
    expect(system).toContain("$$…$$");
    expect(system).toMatch(/hint1[^\n]*concept/i);
    expect(system).toMatch(/must not (contain|state|reveal)[^\n]*final answer/i);
  });

  it("works without an error summary", async () => {
    const create = fakeAi(valid);

    await generateVariant({ ...input, errorSummary: null });

    expect(sentText(create)).not.toContain("null");
  });

  it("regenerates once when hint 1 or 2 leaks the final answer", async () => {
    const create = fakeAi(leaking, valid);

    const result = await generateVariant(input);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.hints[1]).toBe(valid.hint2);
    expect(sentText(create, 1)).toMatch(/final answer/i);
  });

  it("regenerates only once, even when the second variant leaks too", async () => {
    const create = fakeAi(leaking, leaking);

    const result = await generateVariant(input);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.hints[1]).toBe(leaking.hint2);
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("generateVariant.invalid"), fixture("generateVariant.invalid"));

    await expect(generateVariant(input)).rejects.toBeInstanceOf(AiOutputError);
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await generateVariant(input);

    expect(result.body).toBe(valid.body);
    expect(result.hints).toHaveLength(3);
  });
});
