import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { extractSolutions, extractSolutionsSchema } from "./extract-solutions";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

type Raw = { solutions: { questionId: string; found: boolean; body: string }[] };
const valid = fixture("extractSolutions") as Raw;
const pdf = { mime: "application/pdf", data: Buffer.from("solutions") };
const questions = [
  { id: "q1", label: "1", body: String.raw`Differentiate $f(x) = x^2 \sin x$.` },
  { id: "q2", label: "2", body: String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.` },
  { id: "q3", label: "3", body: String.raw`Find the eigenvalues of $A$.` },
];
const without = (id: string) => ({
  solutions: valid.solutions.filter((solution) => solution.questionId !== id),
});

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("extractSolutions fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = extractSolutionsSchema.parse(valid);

    expect(parsed.solutions[0].body).toContain("\\sin x");
    expect(parsed.solutions[2].body).toContain("\\begin{pmatrix}");
    expect(fixtureText("extractSolutions")).toContain("\\\\lambda");
  });

  it("rejects the invalid fixture", () => {
    expect(extractSolutionsSchema.safeParse(fixture("extractSolutions.invalid")).success).toBe(
      false,
    );
  });

  it("rejects a solution that is marked as found but has no text", () => {
    const entry = (found: boolean, body: string) => ({
      solutions: [{ questionId: "q1", found, body }],
    });

    expect(extractSolutionsSchema.safeParse(entry(true, " ")).success).toBe(false);
    expect(extractSolutionsSchema.safeParse(entry(false, "")).success).toBe(true);
  });
});

describe("extractSolutions", () => {
  it("returns one solution for each question id, in the contract shape", async () => {
    const create = fakeAi(valid);

    const result = await extractSolutions({ files: [pdf], questions });

    expect(result).toEqual({
      solutions: valid.solutions.map(({ questionId, body }) => ({ questionId, body })),
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends the file, every question id with its label and body, and the LaTeX rules", async () => {
    const create = fakeAi(valid);

    await extractSolutions({ files: [pdf], questions });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(Array.isArray(content) && content[0].type).toBe("document");
    for (const question of questions) {
      expect(sentText(create)).toContain(question.id);
      expect(sentText(create)).toContain(question.body);
    }
    expect(sentSystem(create)).toContain("$…$");
    expect(sentSystem(create)).toContain("$$…$$");
  });

  it("rejects output that omits a question id, and asks once more", async () => {
    const create = fakeAi(without("q2"), valid);

    const result = await extractSolutions({ files: [pdf], questions });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.solutions.map((solution) => solution.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("throws AiOutputError when a question id is omitted twice", async () => {
    const create = fakeAi(without("q2"), without("q3"));

    await expect(extractSolutions({ files: [pdf], questions })).rejects.toBeInstanceOf(
      AiOutputError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown question id and a repeated question id", async () => {
    const unknown = {
      solutions: [...valid.solutions, { questionId: "q9", found: true, body: "$x = 1$" }],
    };
    const repeated = { solutions: [...valid.solutions, valid.solutions[0]] };
    fakeAi(unknown, repeated);

    await expect(extractSolutions({ files: [pdf], questions })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it("leaves out a question whose solution is not in the document", async () => {
    fakeAi({
      solutions: [
        valid.solutions[0],
        { questionId: "q2", found: false, body: "" },
        valid.solutions[2],
      ],
    });

    const result = await extractSolutions({ files: [pdf], questions });

    expect(result.solutions.map((solution) => solution.questionId)).toEqual(["q1", "q3"]);
  });

  it("makes no request when there are no questions", async () => {
    const create = fakeAi();

    await expect(extractSolutions({ files: [pdf], questions: [] })).resolves.toEqual({
      solutions: [],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("in fixture mode gives the fixture solutions to the given questions, by position", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    const others = ["a", "b", "c", "d"].map((id) => ({ id, label: id, body: "Find $x$." }));

    const result = await extractSolutions({ files: [pdf], questions: others });

    expect(result.solutions.map((solution) => solution.questionId)).toEqual(["a", "b", "c", "d"]);
    expect(result.solutions[1].body).toBe(valid.solutions[1].body);
    expect(result.solutions[3].body).toBe(valid.solutions[0].body);
  });
});
