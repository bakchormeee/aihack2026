import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { fakeAi, fixture, sentSystem, sentText } from "./test-helpers";
import { writeFlawedSolution, writeFlawedSolutionSchema } from "./write-flawed-solution";

type Raw = {
  body: string;
  lines: string[];
  planted: { line: number; misconception: string; whatsWrong: string; correctLine: string }[];
  expectedMinutes: number;
};
const one = fixture("writeFlawedSolution") as Raw;
const two = fixture("writeFlawedSolutionTwo") as Raw;
const clean = fixture("writeCleanSolution") as Raw;
const plantOne = [
  { id: "e1", description: "Drops a sign after a minus bracket.", example: "$3-2+8$" },
];
const plantTwo = [
  { id: "e1", description: "Sign error in a product rule.", example: null },
  { id: "e2", description: "Writes a zero product as one.", example: "$0 \\cdot 0 = 1$" },
];
const request = { topics: ["Algebra"], courseName: "Analysis I" };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("writeFlawedSolution schema", () => {
  it("accepts the three valid fixtures and rejects the invalid one", () => {
    for (const f of [one, two, clean])
      expect(writeFlawedSolutionSchema.safeParse(f).success).toBe(true);
    expect(
      writeFlawedSolutionSchema.safeParse(fixture("writeFlawedSolution.invalid")).success,
    ).toBe(false);
  });

  const withPlanted = (planted: Raw["planted"]) =>
    writeFlawedSolutionSchema.safeParse({ ...one, planted }).success;

  it("needs the planted line to exist and its correct version to differ", () => {
    const base = one.planted[0];
    expect(withPlanted([{ ...base, line: 99 }])).toBe(false);
    expect(withPlanted([{ ...base, correctLine: one.lines[2] }])).toBe(false);
  });

  it("does not allow two errors on one line, or the same misconception twice", () => {
    const base = one.planted[0];
    expect(withPlanted([base, { ...base, misconception: "e2" }])).toBe(false);
    expect(withPlanted([base, { ...base, line: 4 }])).toBe(false);
    expect(withPlanted([base, { ...base, line: 4, misconception: "e2" }])).toBe(true);
  });

  it("allows at most two errors, and 3 to 14 lines", () => {
    const base = one.planted[0];
    expect(
      withPlanted([
        base,
        { ...base, line: 4, misconception: "e2" },
        { ...base, line: 5, misconception: "e3" },
      ]),
    ).toBe(false);
    expect(writeFlawedSolutionSchema.safeParse({ ...clean, lines: ["a", "b"] }).success).toBe(
      false,
    );
    expect(
      writeFlawedSolutionSchema.safeParse({
        ...clean,
        lines: Array.from({ length: 15 }, () => "a"),
      }).success,
    ).toBe(false);
  });

  it("rejects maths outside dollar signs in the question, a line, or the explanation", () => {
    const bad = (change: Partial<Raw>) =>
      writeFlawedSolutionSchema.safeParse({ ...one, ...change }).success;
    expect(bad({ body: "Find x^2 now." })).toBe(false);
    expect(bad({ lines: [...one.lines.slice(0, 4), "So x^2 = 4."] })).toBe(false);
    expect(
      bad({ planted: [{ ...one.planted[0], whatsWrong: "It should be \\frac{1}{2}." }] }),
    ).toBe(false);
    expect(
      bad({ planted: [{ ...one.planted[0], correctLine: "Next, 3 - 2 - 8 with x_1." }] }),
    ).toBe(false);
  });
});

describe("writeFlawedSolution", () => {
  it("returns the question, the lines and the planted errors when the count and ids match", async () => {
    fakeAi(one);

    const result = await writeFlawedSolution({ ...request, plant: plantOne });

    expect(result.lines).toHaveLength(5);
    expect(result.planted).toEqual(one.planted);
  });

  it("accepts two errors for two misconceptions, and no errors for none", async () => {
    fakeAi(two);
    expect((await writeFlawedSolution({ ...request, plant: plantTwo })).planted).toHaveLength(2);

    fakeAi(clean);
    expect((await writeFlawedSolution({ ...request, plant: [] })).planted).toEqual([]);
  });

  it("throws when the exercise plants a different number of errors than asked", async () => {
    fakeAi(one);
    await expect(writeFlawedSolution({ ...request, plant: plantTwo })).rejects.toThrow(/planted 1/);

    fakeAi(one);
    await expect(writeFlawedSolution({ ...request, plant: [] })).rejects.toThrow(/planted 1/);
  });

  it("throws when it plants a misconception that was not asked for", async () => {
    fakeAi({ ...one, planted: [{ ...one.planted[0], misconception: "e9" }] });

    await expect(writeFlawedSolution({ ...request, plant: plantOne })).rejects.toThrow(/planted/);
  });

  it("sends the topics, each misconception with its example, and says when there are none", async () => {
    const create = fakeAi(one, clean);

    await writeFlawedSolution({ ...request, plant: plantOne });
    await writeFlawedSolution({ topics: [], courseName: "Analysis I", plant: [] });

    const first = sentText(create, 0);
    expect(first).toContain("Topics: Algebra");
    expect(first).toContain("e1: Drops a sign after a minus bracket.");
    expect(first).toContain("Example in the student's own words: $3-2+8$");
    const second = sentText(create, 1);
    expect(second).toContain('any topic of the course "Analysis I"');
    expect(second).toContain("none: write a completely correct solution");
  });

  it("tells the model to solve first, plant natural errors only where asked, and write LaTeX", async () => {
    const create = fakeAi(one);

    await writeFlawedSolution({ ...request, plant: plantOne });

    const system = sentSystem(create);
    expect(system).toMatch(/completely and correctly first/i);
    expect(system).toMatch(/every other line must be correct/i);
    expect(system).toMatch(/natural/i);
    expect(system).toContain("$…$");
  });

  it("asks again when the first reply breaks the schema, then throws if it still does", async () => {
    const create = fakeAi(fixture("writeFlawedSolution.invalid"), one);
    await writeFlawedSolution({ ...request, plant: plantOne });
    expect(create).toHaveBeenCalledTimes(2);

    fakeAi(fixture("writeFlawedSolution.invalid"), fixture("writeFlawedSolution.invalid"));
    await expect(writeFlawedSolution({ ...request, plant: plantOne })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it("uses a fixture per number of errors in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    expect((await writeFlawedSolution({ ...request, plant: plantOne })).planted).toHaveLength(1);
    expect((await writeFlawedSolution({ ...request, plant: plantTwo })).planted).toHaveLength(2);
    expect((await writeFlawedSolution({ ...request, plant: [] })).planted).toHaveLength(0);
  });
});
