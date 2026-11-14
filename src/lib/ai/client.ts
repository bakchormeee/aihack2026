// The one wrapper around the Claude API (contract C2, decision 6 in tasks/plan.md).
// Every AI module calls `callAi`; nothing else in the app imports the SDK.
// See README.md in this folder for the model, input limits and output method.

import { readFile } from "node:fs/promises";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type AiFile = { mime: string; data: Buffer };

export type AiCreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** The part of the Anthropic client that `callAi` uses. Tests replace it with a fake. */
export type AiClient = {
  messages: {
    create(params: AiCreateParams): Promise<Pick<Anthropic.Message, "content" | "stop_reason">>;
  };
};

/** The model returned output that does not match the schema, twice in a row. */
export class AiOutputError extends Error {
  readonly callName: string;
  constructor(callName: string, reason: string) {
    super(`AI call "${callName}" returned invalid output: ${reason}`);
    this.name = "AiOutputError";
    this.callName = callName;
  }
}

/** The input cannot be sent to the API (file type, file size, call name). */
export class AiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiInputError";
  }
}

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";
const DEFAULT_MAX_TOKENS = 16000;
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMime = (typeof IMAGE_MIMES)[number];
/** API limit: 10 MB for each image, measured on the base64 text. */
const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
/** Our own limit for one PDF (SPEC: uploads up to 20 MB). The API allows 128 MB for a request. */
const MAX_PDF_BYTES = 32 * 1024 * 1024;

let injectedClient: AiClient | null = null;
let defaultClient: AiClient | null = null;

/** Replace the API client (tests), or pass `null` to go back to the real one. */
export function setAiClient(client: AiClient | null): void {
  injectedClient = client;
}

function getClient(): AiClient {
  if (injectedClient) return injectedClient;
  if (!defaultClient) {
    const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
    defaultClient = { messages: { create: (params) => anthropic.messages.create(params) } };
  }
  return defaultClient;
}

function effort(): Effort {
  const value = process.env.AI_EFFORT;
  return EFFORTS.includes(value as Effort) ? (value as Effort) : "medium";
}

function maxTokens(): number {
  const value = Number(process.env.AI_MAX_TOKENS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_TOKENS;
}

function fileBlock(file: AiFile): Anthropic.ContentBlockParam {
  const data = file.data.toString("base64");
  if (file.mime === "application/pdf") {
    if (file.data.length > MAX_PDF_BYTES) {
      throw new AiInputError("PDF is larger than 32 MB and cannot be sent to the AI.");
    }
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (IMAGE_MIMES.includes(file.mime as ImageMime)) {
    if (data.length > MAX_IMAGE_BASE64_BYTES) {
      throw new AiInputError("Image is larger than the 10 MB API limit; resize it before upload.");
    }
    return {
      type: "image",
      source: { type: "base64", media_type: file.mime as ImageMime, data },
    };
  }
  throw new AiInputError(`File type "${file.mime}" cannot be sent to the AI.`);
}

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

function check<T>(schema: z.ZodType<T>, raw: string): Checked<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "the reply is not valid JSON" };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, reason: issues };
}

function readReply<T>(
  schema: z.ZodType<T>,
  message: Pick<Anthropic.Message, "content" | "stop_reason">,
): Checked<T> {
  if (message.stop_reason === "refusal") return { ok: false, reason: "the model refused" };
  if (message.stop_reason === "max_tokens") {
    return { ok: false, reason: "the reply was cut off at the token limit" };
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  return check(schema, text);
}

async function readFixture<T>(callName: string, schema: z.ZodType<T>): Promise<T> {
  const file = path.join(process.cwd(), "tests", "fixtures", "ai", `${callName}.json`);
  const checked = check(schema, await readFile(file, "utf8"));
  if (!checked.ok) throw new AiOutputError(callName, `fixture ${file}: ${checked.reason}`);
  return checked.value;
}

/**
 * Ask the model for output that matches `schema`.
 *
 * Files go first in the message, then the text. The reply is validated with
 * Zod; an invalid reply is asked for once more, and a second invalid reply
 * throws `AiOutputError`. API failures (network, rate limit, bad request) are
 * not caught here: the SDK already retries the retryable ones.
 *
 * With `AI_FIXTURES=1` no request is made; the result is read from
 * `tests/fixtures/ai/<callName>.json`.
 */
export async function callAi<T>(args: {
  callName: string;
  schema: z.ZodType<T>;
  system: string;
  text: string;
  files?: AiFile[];
}): Promise<T> {
  const { callName, schema, system, text, files = [] } = args;
  if (!/^[A-Za-z0-9_-]+$/.test(callName)) {
    throw new AiInputError(`Invalid AI call name "${callName}".`);
  }
  if (process.env.AI_FIXTURES === "1") return readFixture(callName, schema);

  const fileBlocks = files.map(fileBlock);
  const format = zodOutputFormat(schema);
  const client = getClient();

  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? text
        : `${text}\n\nYour previous reply was rejected (${reason}). Reply again with JSON that matches the schema exactly.`;
    const message = await client.messages.create({
      model: process.env.AI_MODEL || DEFAULT_AI_MODEL,
      max_tokens: maxTokens(),
      system,
      messages: [{ role: "user", content: [...fileBlocks, { type: "text", text: prompt }] }],
      output_config: { effort: effort(), format: { type: "json_schema", schema: format.schema } },
    });
    const checked = readReply(schema, message);
    if (checked.ok) return checked.value;
    reason = checked.reason;
  }
  throw new AiOutputError(callName, reason);
}
