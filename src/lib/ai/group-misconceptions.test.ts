import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { groupMisconceptions, groupMisconceptionsSchema } from "./group-misconceptions";
import { fakeAi, fixture, sentSystem, sentText } from "./test-helpers";

type Raw = {
  newMisconceptions: { key: string; description: string }[];
  placements: { mistake: number; existing: string | null; key: string | null }[];
};
const valid = fixture("groupMisconceptions") as Raw;
const input = {
  existing: [
    {
      id: "m1",
      description: "Mixes up the order of a quotient, e.g. $a/b$ as $b/a$.",
      hidden: false,
    },
    { id: "m2", description: "Forgets a constant of integration.", hidden: true },
  ],
  mistakes: [
    {
      n: 1,
      type: "algebra_slip" as const,
      quote: "$\\int \\sin x = \\cos x$",
      topics: ["Integration"],
    },
    { n: 2, type: "incomplete" as const, quote: "so the integral is $-2$", topics: [] },
  ],
};

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("groupMisconceptions schema", () => {
  it("accepts the valid fixture and rejects the invalid one", () => {
    expect(groupMisconceptionsSchema.safeParse(valid).success).toBe(true);
    expect(
      groupMisconceptionsSchema.safeParse(fixture("groupMisconceptions.invalid")).success,
    ).toBe(false);
  });

  it("needs exactly one of an existing id or a new key on each placement", () => {
    const withPlacement = (placement: Raw["placements"][number]) =>
      groupMisconceptionsSchema.safeParse({ ...valid, placements: [placement] }).success;

    expect(withPlacement({ mistake: 1, existing: "m1", key: null })).toBe(true);
    expect(withPlacement({ mistake: 1, existing: "m1", key: "n1" })).toBe(false);
    expect(withPlacement({ mistake: 1, existing: null, key: null })).toBe(false);
  });

  it("rejects a key that is not among the new misconceptions, and repeated keys", () => {
    expect(
      groupMisconceptionsSchema.safeParse({
        ...valid,
        placements: [{ mistake: 1, existing: null, key: "zzz" }],
      }).success,
    ).toBe(false);
    expect(
      groupMisconceptionsSchema.safeParse({
        ...valid,
        newMisconceptions: [
          { key: "n1", description: "A" },
          { key: "n1", description: "B" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a description with maths outside dollar signs", () => {
    expect(
      groupMisconceptionsSchema.safeParse({
        ...valid,
        newMisconceptions: [{ key: "n1", description: "Writes x^2 as 2x." }],
      }).success,
    ).toBe(false);
  });
});

describe("groupMisconceptions", () => {
  it("returns an existing id or a new description for each placed mistake", async () => {
    fakeAi({
      newMisconceptions: [{ key: "n1", description: "A new error with $x$." }],
      placements: [
        { mistake: 1, existing: "m1", key: null },
        { mistake: 2, existing: null, key: "n1" },
      ],
    });

    expect(await groupMisconceptions(input)).toEqual([
      { mistake: 1, existing: "m1" },
      { mistake: 2, description: "A new error with $x$." },
    ]);
  });

  it("ignores invented mistake numbers, invented ids and repeated placements", async () => {
    fakeAi({
      newMisconceptions: [],
      placements: [
        { mistake: 9, existing: "m1", key: null },
        { mistake: 1, existing: "m77", key: null },
        { mistake: 2, existing: "m1", key: null },
        { mistake: 2, existing: "m2", key: null },
      ],
    });

    expect(await groupMisconceptions(input)).toEqual([{ mistake: 2, existing: "m1" }]);
  });

  it("sends the existing list (marking the hidden one), the numbered mistakes and their topics", async () => {
    const create = fakeAi(valid);

    await groupMisconceptions(input);

    const text = sentText(create);
    expect(text).toContain("m1: Mixes up");
    expect(text).toContain("m2 (hidden): Forgets");
    expect(text).toContain("1. [algebra_slip]");
    expect(text).toContain("(topics: Integration)");
    expect(text).toContain("2. [incomplete] so the integral");
  });

  it("says there are none yet when the list is empty", async () => {
    const create = fakeAi(valid);

    await groupMisconceptions({ ...input, existing: [] });

    expect(sentText(create)).toContain("(none yet)");
  });

  it("tells the model to reuse, to stay specific, and to write LaTeX", async () => {
    const create = fakeAi(valid);

    await groupMisconceptions(input);

    const system = sentSystem(create);
    expect(system).toMatch(/reuse an existing misconception/i);
    expect(system).toMatch(/hidden/i);
    expect(system).toMatch(/specific/i);
    expect(system).toMatch(/apply to other questions/i);
    expect(system).toContain("$…$");
  });

  it("asks again when the first reply breaks the rules, then throws if it still does", async () => {
    const create = fakeAi(fixture("groupMisconceptions.invalid"), valid);
    await groupMisconceptions(input);
    expect(create).toHaveBeenCalledTimes(2);

    fakeAi(fixture("groupMisconceptions.invalid"), fixture("groupMisconceptions.invalid"));
    await expect(groupMisconceptions(input)).rejects.toBeInstanceOf(AiOutputError);
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const placements = await groupMisconceptions(input);

    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({ mistake: 1 });
    expect(placements[0]).toHaveProperty("description");
  });
});
