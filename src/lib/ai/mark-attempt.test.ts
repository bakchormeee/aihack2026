import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_TYPES } from "@/lib/domain";

import { AiOutputError, setAiClient } from "./client";
import { markAttempt, markAttemptSchema } from "./mark-attempt";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

const valid = fixture("markAttempt") as Record<string, unknown>;
const questionBody = String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.`;
const solution = String.raw`By parts, $\int_0^{\pi} x \cos x \, dx = \big[ x \sin x \big]_0^{\pi} - \int_0^{\pi} \sin x \, dx = -2$.`;
const typed = { text: String.raw`$[x \sin x]_0^\pi - [\cos x]_0^\pi = 2$`, files: [] };
const photo = { mime: "image/jpeg", data: Buffer.from("photo") };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("markAttempt fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = markAttemptSchema.parse(valid);

    expect(parsed.feedback).toContain("\\cos x \\, dx");
    expect(fixtureText("markAttempt")).toContain("\\\\sin");
  });

  it("rejects the invalid fixture", () => {
    expect(markAttemptSchema.safeParse(fixture("markAttempt.invalid")).success).toBe(false);
  });

  it("accepts only an integer score from 0 to 100", () => {
    const withScore = (score: unknown) => markAttemptSchema.safeParse({ ...valid, score }).success;

    expect(withScore(0)).toBe(true);
    expect(withScore(100)).toBe(true);
    expect(withScore(-1)).toBe(false);
    expect(withScore(101)).toBe(false);
    expect(withScore(72.5)).toBe(false);
    expect(withScore("60")).toBe(false);
  });

  it("accepts every error type of the domain, and null, and nothing else", () => {
    const withType = (errorType: unknown) =>
      markAttemptSchema.safeParse({ ...valid, errorType }).success;

    for (const errorType of ERROR_TYPES) expect(withType(errorType)).toBe(true);
    expect(withType(null)).toBe(true);
    expect(withType("careless")).toBe(false);
  });
});

describe("markAttempt", () => {
  it("returns exactly the contract fields and never an outcome", async () => {
    fakeAi(valid);

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(result).toEqual(valid);
    expect(Object.keys(result).sort()).toEqual(
      ["errorType", "feedback", "firstWrongStep", "overallFeedback", "score"].sort(),
    );
    expect(result).not.toHaveProperty("outcome");
  });

  it("drops an outcome if the model adds one", async () => {
    fakeAi({ ...valid, outcome: "full" });

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(result).not.toHaveProperty("outcome");
  });

  it("sends the question, the solution and the typed working", async () => {
    const create = fakeAi(valid);

    await markAttempt({ questionBody, solution, working: typed });

    const text = sentText(create);
    expect(text).toContain(questionBody);
    expect(text).toContain(solution);
    expect(text).toContain(typed.text);
    expect(text).not.toMatch(/dispute|re-mark/i);
  });

  it("sends photos of handwritten working as images", async () => {
    const create = fakeAi(valid);

    await markAttempt({ questionBody, solution, working: { text: null, files: [photo, photo] } });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(Array.isArray(content) && content.map((block) => block.type)).toEqual([
      "image",
      "image",
      "text",
    ]);
    expect(sentText(create)).not.toContain("null");
  });

  it("anchors feedback to the first wrong step and accepts other valid methods", async () => {
    const create = fakeAi(valid);

    await markAttempt({ questionBody, solution, working: typed });

    const system = sentSystem(create);
    expect(system).toMatch(/first wrong step/i);
    expect(system).toMatch(/alternative method|different method/i);
    expect(system).toMatch(/full (marks|credit)/i);
    expect(system).toContain("$…$");
    expect(system).toContain("$$…$$");
    expect(system).toMatch(/0 (to|–) 100/);
    for (const errorType of ERROR_TYPES) expect(system).toContain(errorType);
  });

  it("includes the student's reason when the mark is disputed", async () => {
    const create = fakeAi(valid);

    await markAttempt({
      questionBody,
      solution,
      working: typed,
      disputeReason: "I used a substitution instead of parts",
    });

    expect(sentText(create)).toContain("I used a substitution instead of parts");
    expect(sentText(create)).toMatch(/re-mark/i);
  });

  it("clears the error type and first wrong step of a fully correct answer", async () => {
    fakeAi({ ...valid, score: 100, errorType: "method", firstWrongStep: "none" });

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(result.score).toBe(100);
    expect(result.errorType).toBeNull();
    expect(result.firstWrongStep).toBeNull();
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("markAttempt.invalid"), fixture("markAttempt.invalid"));

    await expect(markAttempt({ questionBody, solution, working: typed })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    await expect(markAttempt({ questionBody, solution, working: typed })).resolves.toEqual(valid);
  });
});
