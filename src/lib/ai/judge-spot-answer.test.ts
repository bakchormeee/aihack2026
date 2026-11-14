import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { judgeSpotAnswer, judgeSpotAnswerSchema } from "./judge-spot-answer";
import { fakeAi, fixture, sentSystem, sentText } from "./test-helpers";

const input = {
  question: "Evaluate $3 - (2 + 8)$.",
  lines: [
    {
      line: 3,
      text: "Next, $3 - (2 + 8) = 3 - 2 + 8$.",
      whatsWrong: "The minus applies to both terms.",
      correctLine: "Next, $3 - (2 + 8) = 3 - 2 - 8$.",
      explanation: "The 8 should be subtracted too.",
    },
  ],
};
const verdict = { judgements: [{ line: 3, right: true, comment: "Yes, both terms change sign." }] };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("judgeSpotAnswer schema", () => {
  it("accepts the valid fixture and rejects the invalid one", () => {
    expect(judgeSpotAnswerSchema.safeParse(fixture("judgeSpotAnswer")).success).toBe(true);
    expect(judgeSpotAnswerSchema.safeParse(fixture("judgeSpotAnswer.invalid")).success).toBe(false);
  });

  it("rejects a comment with maths outside dollar signs", () => {
    expect(
      judgeSpotAnswerSchema.safeParse({
        judgements: [{ line: 3, right: true, comment: "You wrote \\frac{1}{2}." }],
      }).success,
    ).toBe(false);
  });
});

describe("judgeSpotAnswer", () => {
  it("returns one verdict per line it was given", async () => {
    fakeAi(verdict);

    expect(await judgeSpotAnswer(input)).toEqual(verdict.judgements);
  });

  it("marks a line the model skipped as not right, and ignores lines that were not asked about", async () => {
    fakeAi({
      judgements: [
        { line: 9, right: true, comment: "Not asked." },
        { line: 3, right: false, comment: "Not quite." },
      ],
    });
    const two = {
      ...input,
      lines: [...input.lines, { ...input.lines[0], line: 5, explanation: "Hmm." }],
    };

    const result = await judgeSpotAnswer(two);

    expect(result).toEqual([
      { line: 3, right: false, comment: "Not quite." },
      { line: 5, right: false, comment: "This explanation could not be judged." },
    ]);
  });

  it("sends the question, each line with its planted error and the student's explanation", async () => {
    const create = fakeAi(verdict);

    await judgeSpotAnswer(input);

    const text = sentText(create);
    expect(text).toContain("Evaluate $3 - (2 + 8)$.");
    expect(text).toContain("Line 3: Next, $3 - (2 + 8) = 3 - 2 + 8$.");
    expect(text).toContain("Planted error: The minus applies to both terms.");
    expect(text).toContain("Correct version: Next, $3 - (2 + 8) = 3 - 2 - 8$.");
    expect(text).toContain("Student's explanation: The 8 should be subtracted too.");
  });

  it("accepts a correct idea in other words, and says vague or different answers are wrong", async () => {
    const create = fakeAi(verdict);

    await judgeSpotAnswer(input);

    const system = sentSystem(create);
    expect(system).toMatch(/even in different words/i);
    expect(system).toMatch(/vague/i);
    expect(system).toMatch(/names a different problem/i);
    expect(system).toContain("$…$");
  });

  it("asks again when the first reply breaks the schema, then throws if it still does", async () => {
    const create = fakeAi(fixture("judgeSpotAnswer.invalid"), verdict);
    await judgeSpotAnswer(input);
    expect(create).toHaveBeenCalledTimes(2);

    fakeAi(fixture("judgeSpotAnswer.invalid"), fixture("judgeSpotAnswer.invalid"));
    await expect(judgeSpotAnswer(input)).rejects.toBeInstanceOf(AiOutputError);
  });

  it("returns the fixture's verdicts in fixture mode, for the lines asked", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await judgeSpotAnswer(input);

    expect(result).toEqual([
      expect.objectContaining({
        line: 3,
        right: true,
        comment: expect.stringContaining("minus sign"),
      }),
    ]);
  });
});
