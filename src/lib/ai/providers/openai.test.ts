import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { extractSolutionsSchema } from "../extract-solutions";
import { generateHintsSchema } from "../generate-hints";
import { generateVariantSchema } from "../generate-variant";
import { groupMisconceptionsSchema } from "../group-misconceptions";
import { judgeSpotAnswerSchema } from "../judge-spot-answer";
import { markAttemptSchema } from "../mark-attempt";
import { matchWorkingSchema } from "../match-working";
import { parseSheetSchema } from "../parse-sheet";
import { summariseSheetSchema } from "../summarise-sheet";
import { writeFlawedSolutionSchema } from "../write-flawed-solution";
import { AiOutputError, callAi } from "../client";
import {
  openAiSchema,
  setOpenAiClient,
  type OpenAiClient,
  type OpenAiCreateParams,
} from "./openai";

const schema = z.object({ answer: z.string().min(1), score: z.number().int().min(0).max(100) });
const args = { callName: "markAttempt", schema, system: "You are a marker.", text: "Mark this." };

type FakeReply = {
  status?: string;
  incomplete_details?: { reason: string } | null;
  output: unknown[];
  usage?: object;
};

/** A Responses API reply whose message text is `text`. */
function reply(text: string): FakeReply {
  return {
    status: "completed",
    output: [
      { type: "reasoning", id: "rs_1", summary: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    ],
    usage: { input_tokens: 50, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } },
  };
}

function fakeOpenAi(...replies: FakeReply[]) {
  const create = vi.fn(async (params: OpenAiCreateParams) => {
    void params;
    const next = replies.shift();
    if (!next) throw new Error("fake OpenAI client: no reply left");
    return next;
  });
  setOpenAiClient({ responses: { create } } as unknown as OpenAiClient);
  return create;
}

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
});

afterEach(() => {
  setOpenAiClient(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("callAi on OpenAI", () => {
  it("sends the route's model and effort, the system prompt, files before text, and a strict schema", async () => {
    const create = fakeOpenAi(reply(JSON.stringify({ answer: "ok", score: 80 })));

    const result = await callAi({
      ...args,
      files: [
        { mime: "application/pdf", data: Buffer.from("pdf-bytes") },
        { mime: "image/jpeg", data: Buffer.from("jpeg-bytes") },
      ],
    });

    expect(result).toEqual({ answer: "ok", score: 80 });
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      model: "gpt-6.2-sol",
      instructions: "You are a marker.",
      reasoning: { effort: "medium" },
      max_output_tokens: 16000,
      store: false,
    });
    expect(params.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "document.pdf",
            file_data: `data:application/pdf;base64,${Buffer.from("pdf-bytes").toString("base64")}`,
          },
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`,
            detail: "auto",
          },
          { type: "input_text", text: "Mark this." },
        ],
      },
    ]);
    expect(params.text?.format).toMatchObject({
      type: "json_schema",
      name: "markAttempt",
      strict: true,
      schema: { type: "object", additionalProperties: false, required: ["answer", "score"] },
    });
  });

  it("sends a cheap call to the cheap model", async () => {
    const create = fakeOpenAi(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi({ ...args, callName: "summariseSheet" });

    expect(create.mock.calls[0][0].model).toBe("gpt-6-luna");
    expect(create.mock.calls[0][0].reasoning?.effort).toBe("low");
  });

  it("retries once on invalid JSON, then throws AiOutputError", async () => {
    const create = fakeOpenAi(reply("not json"), reply(JSON.stringify({ answer: "", score: 5 })));

    await expect(callAi(args)).rejects.toBeInstanceOf(AiOutputError);
    expect(create).toHaveBeenCalledTimes(2);
    const retryText = JSON.stringify(create.mock.calls[1][0].input);
    expect(retryText).toContain("Your previous reply was rejected (the reply is not valid JSON)");
  });

  it("treats a refusal as invalid output", async () => {
    const refusal = {
      status: "completed",
      output: [
        { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "No." }] },
      ],
    };
    const create = fakeOpenAi(refusal, reply(JSON.stringify({ answer: "ok", score: 3 })));

    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 3 });
    expect(JSON.stringify(create.mock.calls[1][0].input)).toContain("the model refused");
  });

  it("treats a reply cut off at the token limit as invalid output", async () => {
    const cutOff = {
      ...reply('{"answer": "o'),
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    const create = fakeOpenAi(cutOff, reply(JSON.stringify({ answer: "ok", score: 4 })));

    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 4 });
    expect(JSON.stringify(create.mock.calls[1][0].input)).toContain("cut off at the token limit");
  });

  it("logs the OpenAI token usage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    fakeOpenAi(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi(args);

    expect(JSON.parse(String(info.mock.calls[0][1]))).toMatchObject({
      provider: "openai",
      model: "gpt-6.2-sol",
      inputTokens: 50,
      outputTokens: 20,
      cachedTokens: 10,
    });
  });

  it("fails clearly when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(callAi(args)).rejects.toThrow(/OPENAI_API_KEY/);
  });
});

describe("openAiSchema", () => {
  const schemas: Record<string, z.ZodType> = {
    parseSheet: parseSheetSchema,
    extractSolutions: extractSolutionsSchema,
    markAttempt: markAttemptSchema,
    matchWorking: matchWorkingSchema,
    generateHints: generateHintsSchema,
    generateVariant: generateVariantSchema,
    writeFlawedSolution: writeFlawedSolutionSchema,
    summariseSheet: summariseSheetSchema,
    judgeSpotAnswer: judgeSpotAnswerSchema,
    groupMisconceptions: groupMisconceptionsSchema,
  };

  /** Every object in a JSON schema, depth first. */
  function objects(node: unknown, found: Record<string, unknown>[] = []) {
    if (Array.isArray(node)) node.forEach((child) => objects(child, found));
    else if (node && typeof node === "object") {
      found.push(node as Record<string, unknown>);
      Object.values(node).forEach((child) => objects(child, found));
    }
    return found;
  }

  for (const [callName, zodSchema] of Object.entries(schemas)) {
    it(`converts the ${callName} schema to an OpenAI strict schema`, () => {
      const json = openAiSchema(zodSchema, callName);

      expect(json.type).toBe("object");
      for (const node of objects(json)) {
        expect(node).not.toHaveProperty("minLength");
        expect(node).not.toHaveProperty("maxLength");
        if (node.type === "object" && node.properties) {
          expect(node.additionalProperties).toBe(false);
          expect([...(node.required as string[])].sort()).toEqual(
            Object.keys(node.properties).sort(),
          );
        }
      }
    });
  }
});
