// Sends one AI request to the Claude API (Messages API, structured JSON output).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { AiConfigError } from "../routes";
import type { PreparedFile } from "../files";
import type { Adapter } from "./types";

export type AiCreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** The part of the Anthropic client that the adapter uses. Tests replace it with a fake. */
export type AiClient = {
  messages: {
    create(
      params: AiCreateParams,
    ): Promise<
      Pick<Anthropic.Message, "content" | "stop_reason"> & { usage?: Partial<Anthropic.Usage> }
    >;
  };
};

let injectedClient: AiClient | null = null;
let defaultClient: AiClient | null = null;

/** Replace the Claude API client (tests), or pass `null` to go back to the real one. */
export function setAiClient(client: AiClient | null): void {
  injectedClient = client;
}

function getClient(): AiClient {
  if (injectedClient) return injectedClient;
  if (!defaultClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new AiConfigError(
        "ANTHROPIC_API_KEY is not set, but an AI call is routed to anthropic (see AI_PROVIDER and AI_ROUTE_*).",
      );
    }
    const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
    defaultClient = { messages: { create: (params) => anthropic.messages.create(params) } };
  }
  return defaultClient;
}

function fileBlock(file: PreparedFile): Anthropic.ContentBlockParam {
  if (file.kind === "pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.base64 },
    };
  }
  return { type: "image", source: { type: "base64", media_type: file.mime, data: file.base64 } };
}

export const anthropicAdapter: Adapter = {
  async send({ route, system, prompt, files, schema, maxTokens }) {
    const message = await getClient().messages.create({
      model: route.model,
      max_tokens: maxTokens,
      system,
      messages: [
        { role: "user", content: [...files.map(fileBlock), { type: "text", text: prompt }] },
      ],
      output_config: {
        effort: route.effort,
        format: { type: "json_schema", schema: zodOutputFormat(schema).schema },
      },
    });
    const usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cachedTokens: message.usage?.cache_read_input_tokens ?? 0,
    };
    if (message.stop_reason === "refusal") return { ok: false, reason: "the model refused", usage };
    if (message.stop_reason === "max_tokens") {
      return { ok: false, reason: "the reply was cut off at the token limit", usage };
    }
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { ok: true, text, usage };
  },
};
