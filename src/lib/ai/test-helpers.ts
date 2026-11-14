// Helpers for the tests in this folder. Not imported by application code.

import { readFileSync } from "node:fs";
import path from "node:path";

import { vi } from "vitest";

import { setAiClient, type AiClient, type AiCreateParams } from "./client";

/** The raw text of `tests/fixtures/ai/<name>.json`. */
export function fixtureText(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests", "fixtures", "ai", `${name}.json`), "utf8");
}

/** The parsed content of `tests/fixtures/ai/<name>.json`. */
export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

/**
 * Install a fake API client that answers with the given values in order
 * (each is sent as the JSON text of one reply). Returns the mock, so a test
 * can read the requests that were made.
 */
export function fakeAi(...outputs: unknown[]) {
  const create = vi.fn(async (params: AiCreateParams) => {
    void params;
    if (outputs.length === 0) throw new Error("fakeAi: no reply left");
    const text = JSON.stringify(outputs.shift());
    return { stop_reason: "end_turn", content: [{ type: "text", text }] };
  });
  setAiClient({ messages: { create } } as unknown as AiClient);
  return create;
}

/** The text block of request number `index` made through `fakeAi`. */
export function sentText(create: ReturnType<typeof fakeAi>, index = 0): string {
  const content = create.mock.calls[index][0].messages[0].content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/** The system prompt of request number `index` made through `fakeAi`. */
export function sentSystem(create: ReturnType<typeof fakeAi>, index = 0): string {
  return String(create.mock.calls[index][0].system);
}
