import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_TYPES } from "@/lib/domain";

import { AiOutputError, setAiClient } from "./client";
import { markAttempt, markAttemptSchema } from "./mark-attempt";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

type Raw = Record<string, unknown>;
const valid = fixture("markAttempt") as Raw;
const rawMistake = (o: Raw = {}) => ({
  type: "algebra_slip",
  quote: "$a_n$",
  hint: "Check the sign when you integrate.",
  fileIndex: null,
  page: null,
  box: null,
  ...o,
});
const withMarks = (score: number, mistakes: Raw[]) => ({ ...valid, score, mistakes });

const questionBody = String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.`;
const solution = String.raw`By parts, $\int_0^{\pi} x \cos x \, dx = \big[ x \sin x \big]_0^{\pi} - \int_0^{\pi} \sin x \, dx = -2$.`;
const typed = { text: String.raw`$[x \sin x]_0^\pi - [\cos x]_0^\pi = 2$`, files: [] };
const photo = { mime: "image/jpeg", data: Buffer.from("photo") };
const pdf = { mime: "application/pdf", data: Buffer.from("pdf") };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("markAttempt schema", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = markAttemptSchema.parse(valid);

    expect(parsed.mistakes[0].quote).toContain("\\int_0^{\\pi}");
    expect(fixtureText("markAttempt")).toContain("\\\\sin");
  });

  it("rejects the invalid fixture", () => {
    expect(markAttemptSchema.safeParse(fixture("markAttempt.invalid")).success).toBe(false);
  });

  it("accepts only a whole-number score from 0 to 5", () => {
    const ok = (score: unknown) => markAttemptSchema.safeParse({ ...valid, score }).success;

    expect(ok(0)).toBe(true);
    expect(ok(5)).toBe(false); // a 5 may not list mistakes, and the fixture does
    expect(ok(3)).toBe(true);
    expect(ok(6)).toBe(false);
    expect(ok(-1)).toBe(false);
    expect(ok(2.5)).toBe(false);
    expect(ok("3")).toBe(false);
  });

  it("accepts every error type of the domain and nothing else", () => {
    const ok = (type: unknown) =>
      markAttemptSchema.safeParse(withMarks(3, [rawMistake({ type })])).success;

    for (const type of ERROR_TYPES) expect(ok(type)).toBe(true);
    expect(ok("careless")).toBe(false);
  });

  it("a 5 means fully correct, so it may list no mistakes", () => {
    expect(markAttemptSchema.safeParse(withMarks(5, [])).success).toBe(true);
    expect(markAttemptSchema.safeParse(withMarks(5, [rawMistake()])).success).toBe(false);
  });

  it("a 4 needs one or two careless slips and nothing structural", () => {
    const careless = rawMistake({ type: "arithmetic_slip" });
    const ok = (mistakes: Raw[]) => markAttemptSchema.safeParse(withMarks(4, mistakes)).success;

    expect(ok([careless])).toBe(true);
    expect(ok([careless, rawMistake({ type: "notation" })])).toBe(true);
    expect(ok([])).toBe(false);
    expect(ok([careless, careless, careless])).toBe(false); // three or more slips is a 3, not a 4
    expect(ok([careless, rawMistake({ type: "method" })])).toBe(false);
  });

  it("a score of 1 to 3 lists at least one mistake; a 0 may list none", () => {
    for (const score of [1, 2, 3])
      expect(markAttemptSchema.safeParse(withMarks(score, [])).success).toBe(false);
    expect(markAttemptSchema.safeParse(withMarks(0, [])).success).toBe(true);
  });

  it("allows at most 8 mistakes", () => {
    const nine = Array.from({ length: 9 }, () => rawMistake({ type: "method" }));
    expect(markAttemptSchema.safeParse(withMarks(2, nine)).success).toBe(false);
  });

  it.each([
    ["hint", { mistakes: [rawMistake({ hint: "Check \\frac{1}{2} again." })] }],
    ["quote", { mistakes: [rawMistake({ quote: "a_{N+1} = a_N" })] }],
    ["feedback", { feedback: "You wrote x^2 where you needed more." }],
    ["overall comment", { overallFeedback: "Use \\int carefully." }],
  ])("rejects maths outside dollar signs in the %s", (_name, change) => {
    expect(markAttemptSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("markAttempt", () => {
  it("returns the score, the mistakes with a location, and the two comments, never an outcome", async () => {
    fakeAi(valid);

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(Object.keys(result).sort()).toEqual([
      "feedback",
      "mistakes",
      "overallFeedback",
      "score",
    ]);
    expect(result.score).toBe(3);
    expect(result.mistakes).toHaveLength(2);
    expect(result.mistakes[0]).toEqual({
      type: "algebra_slip",
      quote: (valid.mistakes as Raw[])[0].quote,
      hint: (valid.mistakes as Raw[])[0].hint,
      location: { kind: "text" },
    });
    expect(result).not.toHaveProperty("outcome");
  });

  it("drops an outcome if the model adds one", async () => {
    fakeAi({ ...valid, outcome: "full" });

    expect(await markAttempt({ questionBody, solution, working: typed })).not.toHaveProperty(
      "outcome",
    );
  });

  it("puts a mistake on a photo at its box, kept inside the image", async () => {
    fakeAi(
      withMarks(3, [
        rawMistake({
          type: "method",
          fileIndex: 1,
          box: { x: 0.9, y: -0.1, width: 0.4, height: 0.2 },
        }),
      ]),
    );

    const { mistakes } = await markAttempt({
      questionBody,
      solution,
      working: { text: null, files: [photo, photo] },
    });

    const location = mistakes[0].location;
    expect(location.kind).toBe("image");
    if (location.kind !== "image") return;
    expect(location.fileIndex).toBe(1);
    expect(location.box.x).toBeGreaterThanOrEqual(0);
    expect(location.box.y).toBe(0);
    expect(location.box.x + location.box.width).toBeLessThanOrEqual(1);
    expect(location.box.height).toBeCloseTo(0.1); // 0.2 high from y = -0.1 is cut to the image
  });

  it("gives a mistake on a photo with no box the plain text location, so it is listed but not drawn", async () => {
    fakeAi(withMarks(3, [rawMistake({ type: "method", fileIndex: 0, box: null })]));

    const { mistakes } = await markAttempt({
      questionBody,
      solution,
      working: { text: null, files: [photo] },
    });

    expect(mistakes[0].location).toEqual({ kind: "text" });
  });

  it("gives a mistake in a PDF its page number, at least 1", async () => {
    fakeAi(
      withMarks(3, [
        rawMistake({ type: "method", fileIndex: 0, page: 2 }),
        rawMistake({ type: "method", fileIndex: 0, page: null }),
      ]),
    );

    const { mistakes } = await markAttempt({
      questionBody,
      solution,
      working: { text: null, files: [pdf] },
    });

    expect(mistakes[0].location).toEqual({ kind: "pdf", fileIndex: 0, page: 2 });
    expect(mistakes[1].location).toEqual({ kind: "pdf", fileIndex: 0, page: 1 });
  });

  it("treats a file index that does not exist as the plain text location", async () => {
    fakeAi(
      withMarks(3, [
        rawMistake({
          type: "method",
          fileIndex: 4,
          box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
        }),
      ]),
    );

    const { mistakes } = await markAttempt({
      questionBody,
      solution,
      working: { text: null, files: [photo] },
    });

    expect(mistakes[0].location).toEqual({ kind: "text" });
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

  it("sends photos as images and says which file is which", async () => {
    const create = fakeAi(valid);

    await markAttempt({ questionBody, solution, working: { text: null, files: [photo, pdf] } });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(Array.isArray(content) && content.map((block) => block.type)).toEqual([
      "image",
      "document",
      "text",
    ]);
    const text = sentText(create);
    expect(text).toMatch(/file 0/i);
    expect(text).toMatch(/file 1/i);
    expect(text).not.toContain("null");
  });

  it("sets out the 0 to 5 scheme, careless against structural, hints only, and LaTeX", async () => {
    const create = fakeAi(valid);

    await markAttempt({ questionBody, solution, working: typed });

    const system = sentSystem(create);
    for (const line of ["5 =", "4 =", "3 =", "2 =", "1 =", "0 ="]) expect(system).toContain(line);
    expect(system).toMatch(/careless/i);
    expect(system).toMatch(/structural/i);
    for (const type of ERROR_TYPES) expect(system).toContain(type);
    expect(system).toMatch(/never give the corrected step/i);
    expect(system).toMatch(/alternative method|different method/i);
    expect(system).toMatch(/crossed out/i);
    expect(system).toMatch(/fraction/i); // box positions are fractions of the image
    expect(system).toContain("$…$");
    expect(system).toContain("$$…$$");
    expect(system).not.toMatch(/0 (to|–) 100/);
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

  it("asks again, naming the problem, when maths is written outside dollar signs", async () => {
    const create = fakeAi({ ...valid, feedback: "You wrote x^2 but needed more." }, valid);

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(create).toHaveBeenCalledTimes(2);
    expect(sentText(create, 1)).toMatch(/dollar|\$/);
    expect(result.feedback).toBe(valid.feedback);
  });

  it("asks again when a 4 lists a structural mistake", async () => {
    const create = fakeAi(
      withMarks(4, [rawMistake({ type: "method" })]),
      withMarks(4, [rawMistake()]),
    );

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.score).toBe(4);
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("markAttempt.invalid"), fixture("markAttempt.invalid"));

    await expect(markAttempt({ questionBody, solution, working: typed })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it("returns the mapped fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await markAttempt({ questionBody, solution, working: typed });

    expect(result.score).toBe(3);
    expect(result.mistakes.map((m) => m.type)).toEqual(["algebra_slip", "incomplete"]);
  });
});
