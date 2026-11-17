import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AiInputError,
  AiOutputError,
  callAi,
  setAiClient,
  type AiClient,
  type AiCreateParams,
} from "./client";

const schema = z.object({ answer: z.string(), score: z.number().int().min(0).max(100) });

/** A stand-in for one Messages API response whose text is `text`. */
function reply(text: string, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text }] };
}

/** A fake client that returns the given replies in order and records the requests. */
function fakeClient(...replies: (ReturnType<typeof reply> & { usage?: object })[]) {
  const create = vi.fn(async (params: AiCreateParams) => {
    void params;
    const next = replies.shift();
    if (!next) throw new Error("fake client: no reply left");
    return next;
  });
  setAiClient({ messages: { create } } as unknown as AiClient);
  return create;
}

const args = { callName: "demo", schema, system: "You are a marker.", text: "Mark this." };

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("callAi", () => {
  it("returns the validated output of a valid reply", async () => {
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 80 })));

    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 80 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends the model from AI_MODEL, the system prompt and a JSON schema format", async () => {
    vi.stubEnv("AI_MODEL", "claude-test-model");
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi(args);

    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-test-model");
    expect(params.system).toBe("You are a marker.");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.messages).toHaveLength(1);
  });

  it("uses claude-sonnet-5-5 when AI_MODEL is not set", async () => {
    vi.stubEnv("AI_MODEL", "");
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi(args);

    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  });

  it("sends files before the text: a PDF as a document, a photo as an image", async () => {
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi({
      ...args,
      files: [
        { mime: "application/pdf", data: Buffer.from("pdf-bytes") },
        { mime: "image/jpeg", data: Buffer.from("jpeg-bytes") },
      ],
    });

    const content = create.mock.calls[0][0].messages[0].content;
    expect(content).toEqual([
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: Buffer.from("pdf-bytes").toString("base64"),
        },
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: Buffer.from("jpeg-bytes").toString("base64"),
        },
      },
      { type: "text", text: "Mark this." },
    ]);
  });

  it("rejects a file type the API cannot read, without calling the API", async () => {
    const create = fakeClient();

    await expect(
      callAi({ ...args, files: [{ mime: "image/heic", data: Buffer.from("x") }] }),
    ).rejects.toBeInstanceOf(AiInputError);
    expect(create).not.toHaveBeenCalled();
  });

  it("retries once when the first reply is invalid, then succeeds", async () => {
    const create = fakeClient(
      reply(JSON.stringify({ answer: "ok", score: 250 })),
      reply(JSON.stringify({ answer: "ok", score: 50 })),
    );

    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 50 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries when the reply is not JSON or was cut off", async () => {
    const create = fakeClient(
      reply("not json"),
      reply(JSON.stringify({ answer: "ok", score: 50 })),
    );
    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 50 });
    expect(create).toHaveBeenCalledTimes(2);

    const cutOff = fakeClient(
      reply(JSON.stringify({ answer: "ok", score: 50 }), "max_tokens"),
      reply(JSON.stringify({ answer: "ok", score: 60 })),
    );
    await expect(callAi(args)).resolves.toEqual({ answer: "ok", score: 60 });
    expect(cutOff).toHaveBeenCalledTimes(2);
  });

  it("throws AiOutputError after the second invalid reply", async () => {
    const create = fakeClient(reply("{}"), reply(JSON.stringify({ answer: 1 })));

    const error = await callAi(args).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiOutputError);
    expect((error as AiOutputError).callName).toBe("demo");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a refusal as invalid output", async () => {
    const create = fakeClient(reply("", "refusal"), reply("", "refusal"));

    await expect(callAi(args)).rejects.toBeInstanceOf(AiOutputError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the API itself fails", async () => {
    const create = vi.fn(async () => {
      throw new Error("network down");
    });
    setAiClient({ messages: { create } } as unknown as AiClient);

    await expect(callAi(args)).rejects.toThrow("network down");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps LaTeX backslashes intact through the JSON round trip", async () => {
    const latex = z.object({ body: z.string() });
    const body = String.raw`Show that $\frac{d}{dx}\sin x = \cos x$ and $$\int_0^1 x\,dx = \tfrac{1}{2}.$$ Use \nabla, \theta, \beta, \rho, \frac, \text{if } x \neq 0 \\ next row`;
    fakeClient(reply(JSON.stringify({ body })));

    const result = await callAi({ ...args, schema: latex });

    expect(result.body).toBe(body);
    expect(result.body).toContain("\\frac{d}{dx}");
    expect(result.body).toContain("\\nabla");
    expect(result.body).toContain("\\theta");
  });
});

describe("callAi routes", () => {
  it("sends a strong call to Claude exactly as before the routes existed", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi({
      ...args,
      callName: "markAttempt",
      files: [{ mime: "image/png", data: Buffer.from("png") }],
    });

    expect(create.mock.calls[0][0]).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      system: "You are a marker.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: Buffer.from("png").toString("base64"),
              },
            },
            { type: "text", text: "Mark this." },
          ],
        },
      ],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: expect.objectContaining({ type: "object" }) },
      },
    });
  });

  it("sends a cheap call to the cheap model at its effort", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const create = fakeClient(reply(JSON.stringify({ answer: "ok", score: 1 })));

    await callAi({ ...args, callName: "summariseSheet" });

    expect(create.mock.calls[0][0].model).toBe("claude-haiku-5-5");
    expect(create.mock.calls[0][0].output_config?.effort).toBe("low");
  });

  it("logs one usage line per request, with no prompt text", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    fakeClient(
      {
        ...reply("not json"),
        usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 100 },
      },
      reply(JSON.stringify({ answer: "ok", score: 1 })),
    );

    await callAi({ ...args, callName: "markAttempt" });

    expect(info).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(info.mock.calls[0][1]));
    expect(info.mock.calls[0][0]).toBe("ai.usage");
    expect(first).toEqual({
      callName: "markAttempt",
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "medium",
      attempt: 1,
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 100,
    });
    expect(JSON.parse(String(info.mock.calls[1][1])).attempt).toBe(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain("Mark this.");
  });

  it("fails with the variable's name when a route is malformed, before any request", async () => {
    vi.stubEnv("AI_ROUTE_markAttempt", "openai");
    const create = fakeClient();

    await expect(callAi({ ...args, callName: "markAttempt" })).rejects.toThrow(
      /AI_ROUTE_markAttempt/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("callAi in fixture mode", () => {
  function fixtureDir(files: Record<string, string>) {
    const root = mkdtempSync(path.join(tmpdir(), "ai-fixtures-"));
    const dir = path.join(root, "tests", "fixtures", "ai");
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files))
      writeFileSync(path.join(dir, name), content);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.stubEnv("AI_FIXTURES", "1");
  }

  it("returns tests/fixtures/ai/<callName>.json and never calls the API", async () => {
    const body = String.raw`Find $\frac{dy}{dx}$ for $y = x^2$.`;
    fixtureDir({ "demo.json": JSON.stringify({ answer: body, score: 70 }) });
    const create = fakeClient();

    await expect(callAi(args)).resolves.toEqual({ answer: body, score: 70 });
    expect(create).not.toHaveBeenCalled();
  });

  it("throws AiOutputError when the fixture does not match the schema", async () => {
    fixtureDir({ "demo.json": JSON.stringify({ answer: "ok" }) });

    await expect(callAi(args)).rejects.toBeInstanceOf(AiOutputError);
  });

  it("rejects a call name that is not a plain file name", async () => {
    fixtureDir({});

    await expect(callAi({ ...args, callName: "../secret" })).rejects.toBeInstanceOf(AiInputError);
  });
});
