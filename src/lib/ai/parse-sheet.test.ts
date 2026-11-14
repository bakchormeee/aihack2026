import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { parseSheet, parseSheetSchema } from "./parse-sheet";
import { fakeAi, fixture, fixtureText, sentSystem, sentText } from "./test-helpers";

const pdf = { mime: "application/pdf", data: Buffer.from("sheet") };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("parseSheet fixtures", () => {
  it("accepts the valid fixture, which contains LaTeX with backslashes", () => {
    const parsed = parseSheetSchema.parse(fixture("parseSheet"));

    expect(parsed.questions.length).toBeGreaterThan(1);
    expect(parsed.questions[0].body).toContain("\\sin");
    expect(parsed.questions[3].body).toContain("\\begin{pmatrix}");
    expect(fixtureText("parseSheet")).toContain("\\\\");
  });

  it("rejects the invalid fixture", () => {
    expect(parseSheetSchema.safeParse(fixture("parseSheet.invalid")).success).toBe(false);
  });

  it("rejects a sheet with no questions, a blank label and a time of zero", () => {
    expect(parseSheetSchema.safeParse({ questions: [], newTopics: [] }).success).toBe(false);
    const question = { label: "1", body: "Find $x$.", topics: ["Algebra"], expectedMinutes: 5 };
    const withQuestion = (q: object) => ({ questions: [{ ...question, ...q }], newTopics: [] });
    expect(parseSheetSchema.safeParse(withQuestion({})).success).toBe(true);
    expect(parseSheetSchema.safeParse(withQuestion({ label: " " })).success).toBe(false);
    expect(parseSheetSchema.safeParse(withQuestion({ expectedMinutes: 0 })).success).toBe(false);
    expect(parseSheetSchema.safeParse(withQuestion({ topics: [] })).success).toBe(false);
  });
});

describe("parseSheet", () => {
  it("returns questions and new topics in the contract shape", async () => {
    fakeAi(fixture("parseSheet"));

    const result = await parseSheet({ files: [pdf], existingTopics: [] });

    expect(result).toEqual(fixture("parseSheet"));
    expect(Object.keys(result.questions[0]).sort()).toEqual(
      ["body", "expectedMinutes", "label", "topics"].sort(),
    );
    expect(Object.keys(result.newTopics[0]).sort()).toEqual(
      ["name", "parent", "prerequisites"].sort(),
    );
  });

  it("sends the files, the existing topics and the LaTeX rules", async () => {
    const create = fakeAi(fixture("parseSheet"));

    await parseSheet({ files: [pdf], existingTopics: ["Chain rule", "Limits"] });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(Array.isArray(content) && content[0].type).toBe("document");
    expect(sentText(create)).toContain("Chain rule");
    expect(sentText(create)).toContain("Limits");
    expect(sentSystem(create)).toContain("$…$");
    expect(sentSystem(create)).toContain("$$…$$");
    expect(create.mock.calls[0][0].system).not.toContain("undefined");
  });

  it("tells the model to make every part its own question, labelled with its number, and to keep each body self-contained", async () => {
    const create = fakeAi(fixture("parseSheet"));

    await parseSheet({ files: [pdf], existingTopics: [] });

    const system = sentSystem(create);
    // Parts such as (a), (b), (i), (ii) are separate questions, so that each gets its own hints, answer and mark.
    expect(system).toMatch(/every lettered part/i);
    expect(system).toMatch(/\(i\), \(ii\)/);
    expect(system).toContain('"2(a)"');
    expect(system).toContain('"3(a)(ii)"');
    expect(system).toMatch(/introduction/i);
    // The old rule, which kept parts inside one question, must be gone.
    expect(system).not.toMatch(/never make a sub-part its own question/i);
  });

  it("does not list an existing topic as new, whatever its letter case", async () => {
    fakeAi(fixture("parseSheet"));

    const result = await parseSheet({ files: [pdf], existingTopics: ["product RULE"] });

    expect(result.newTopics.map((t) => t.name)).not.toContain("Product rule");
    expect(result.questions[0].topics).toEqual(["product RULE"]);
  });

  it("adds a topic that a question uses but the model did not declare", async () => {
    fakeAi({
      questions: [
        {
          label: "1",
          body: "Find $\\lim_{x \\to 0} \\frac{\\sin x}{x}$.",
          topics: ["Limits"],
          expectedMinutes: 6,
        },
      ],
      newTopics: [],
    });

    const result = await parseSheet({ files: [pdf], existingTopics: [] });

    expect(result.newTopics).toEqual([{ name: "Limits", parent: null, prerequisites: [] }]);
  });

  it("throws AiOutputError when the model returns the invalid fixture twice", async () => {
    fakeAi(fixture("parseSheet.invalid"), fixture("parseSheet.invalid"));

    await expect(parseSheet({ files: [pdf], existingTopics: [] })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });

  it("returns the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");

    const result = await parseSheet({ files: [pdf], existingTopics: [] });

    expect(result).toEqual(fixture("parseSheet"));
  });
});
