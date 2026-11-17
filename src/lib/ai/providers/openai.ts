// Sends one AI request to the OpenAI API (Responses API, strict structured JSON output).

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

import type { PreparedFile } from "../files";
import { AiConfigError } from "../routes";
import type { Adapter } from "./types";

export type OpenAiCreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;

/** The part of the OpenAI client that the adapter uses. Tests replace it with a fake. */
export type OpenAiClient = {
  responses: {
    create(
      params: OpenAiCreateParams,
    ): Promise<
      Pick<OpenAI.Responses.Response, "output" | "status" | "incomplete_details" | "usage">
    >;
  };
};

let injectedClient: OpenAiClient | null = null;
let defaultClient: OpenAiClient | null = null;

/** Replace the OpenAI API client (tests), or pass `null` to go back to the real one. */
export function setOpenAiClient(client: OpenAiClient | null): void {
  injectedClient = client;
}

function getClient(): OpenAiClient {
  if (injectedClient) return injectedClient;
  if (!process.env.OPENAI_API_KEY) {
    throw new AiConfigError(
      "OPENAI_API_KEY is not set, but an AI call is routed to openai. Set the key, or set AI_PROVIDER=anthropic.",
    );
  }
  if (!defaultClient) {
    const openai = new OpenAI(); // reads OPENAI_API_KEY
    defaultClient = { responses: { create: (params) => openai.responses.create(params) } };
  }
  return defaultClient;
}

/** Keywords OpenAI strict mode may reject. Zod still checks them on the reply. */
const UNSUPPORTED = ["minLength", "maxLength"];

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !UNSUPPORTED.includes(key))
      .map(([key, value]) => [key, strip(value)]),
  );
}

/** The JSON schema sent for `schema`: OpenAI's strict conversion, without unsupported keywords. */
export function openAiSchema(schema: z.ZodType, name: string): Record<string, unknown> {
  return strip(zodTextFormat(schema, name).schema) as Record<string, unknown>;
}

function filePart(file: PreparedFile): OpenAI.Responses.ResponseInputContent {
  const dataUrl = `data:${file.mime};base64,${file.base64}`;
  if (file.kind === "pdf") {
    return { type: "input_file", filename: "document.pdf", file_data: dataUrl };
  }
  return { type: "input_image", image_url: dataUrl, detail: "auto" };
}

export const openAiAdapter: Adapter = {
  async send({ callName, route, system, prompt, files, schema, maxTokens }) {
    const response = await getClient().responses.create({
      model: route.model,
      instructions: system,
      input: [
        { role: "user", content: [...files.map(filePart), { type: "input_text", text: prompt }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: callName,
          schema: openAiSchema(schema, callName),
          strict: true,
        },
      },
      reasoning: { effort: route.effort },
      max_output_tokens: maxTokens,
      // Student work is not kept by OpenAI for later retrieval.
      store: false,
    });
    const usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    };
    const parts = response.output.flatMap((item) => (item.type === "message" ? item.content : []));
    if (parts.some((part) => part.type === "refusal")) {
      return { ok: false, reason: "the model refused", usage };
    }
    if (response.status === "incomplete") {
      const why = response.incomplete_details?.reason;
      return {
        ok: false,
        reason:
          why === "max_output_tokens"
            ? "the reply was cut off at the token limit"
            : `the reply is incomplete (${why ?? "unknown reason"})`,
        usage,
      };
    }
    const text = parts.map((part) => (part.type === "output_text" ? part.text : "")).join("");
    return { ok: true, text, usage };
  },
};
