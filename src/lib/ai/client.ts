// The one wrapper around the AI APIs (contract C2, decision 6 in tasks/plan.md).
// Every AI module calls `callAi`; nothing else in the app imports an AI SDK.
// Each call's provider, model and effort come from ./routes.ts; the request itself is
// built in ./providers/. See README.md in this folder.

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { z } from "zod";

import { currentAiUser, reserveAiCall } from "./budget";
import { AiInputError, AiOutputError } from "./errors";
import { prepareFile, type AiFile } from "./files";
import { anthropicAdapter } from "./providers/anthropic";
import type { Adapter, Usage } from "./providers/types";
import { AiConfigError, maxTokens, routeFor, type Provider, type Route } from "./routes";

export { AiInputError, AiOutputError } from "./errors";
export type { AiFile } from "./files";
export { setAiClient, type AiClient, type AiCreateParams } from "./providers/anthropic";
export { AiConfigError } from "./routes";

const ADAPTERS: Record<Provider, Adapter> = {
  anthropic: anthropicAdapter,
  openai: {
    send() {
      throw new AiConfigError(
        "The OpenAI provider is not available yet; set AI_PROVIDER=anthropic.",
      );
    },
  },
};

function logUsage(callName: string, route: Route, attempt: number, usage: Usage): void {
  console.info("ai.usage", JSON.stringify({ callName, ...route, attempt, ...usage }));
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

async function readFixture<T>(callName: string, schema: z.ZodType<T>): Promise<T> {
  const file = path.join(process.cwd(), "tests", "fixtures", "ai", `${callName}.json`);
  const checked = check(schema, await readFile(file, "utf8"));
  if (!checked.ok) throw new AiOutputError(callName, `fixture ${file}: ${checked.reason}`);
  return checked.value;
}

/**
 * Ask the model for output that matches `schema`, on the call's route (./routes.ts).
 *
 * Files go first in the message, then the text. The reply is validated with
 * Zod; an invalid reply is asked for once more, and a second invalid reply
 * throws `AiOutputError`. API failures (network, rate limit, bad request) are
 * not caught here: the SDK already retries the retryable ones. One `ai.usage` line
 * (call name, route, attempt, tokens; never prompt text) is logged per request.
 *
 * With `AI_FIXTURES=1` no request is made; the result is read from
 * `tests/fixtures/ai/<callName>.json`.
 *
 * Inside `withAiUser` (./budget.ts), one call is reserved from the user's demo budget
 * before each request: the retry after an invalid reply is a second request, so it
 * counts as a second call. A fixture answer counts as one call. A demo copy at its
 * limit gets `AiLimitError` and no request is made.
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
  const reserve = async () => {
    const userId = currentAiUser();
    if (userId) await reserveAiCall(userId);
  };
  if (process.env.AI_FIXTURES === "1") {
    await reserve();
    return readFixture(callName, schema);
  }

  const route = routeFor(callName);
  const prepared = files.map(prepareFile);
  const adapter = ADAPTERS[route.provider];

  let reason = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt =
      attempt === 1
        ? text
        : `${text}\n\nYour previous reply was rejected (${reason}). Reply again with JSON that matches the schema exactly.`;
    await reserve();
    const reply = await adapter.send({
      callName,
      route,
      system,
      prompt,
      files: prepared,
      schema,
      maxTokens: maxTokens(),
    });
    logUsage(callName, route, attempt, reply.usage);
    const checked = reply.ok ? check(schema, reply.text) : reply;
    if (checked.ok) return checked.value;
    reason = checked.reason;
  }
  throw new AiOutputError(callName, reason);
}
