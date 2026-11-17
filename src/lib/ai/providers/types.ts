// The contract between `callAi` (shared logic) and one provider's request code.

import type { z } from "zod";

import type { PreparedFile } from "../files";
import type { Route } from "../routes";

export type SendArgs = {
  callName: string;
  route: Route;
  system: string;
  /** The text part, sent after the files. */
  prompt: string;
  files: PreparedFile[];
  schema: z.ZodType;
  maxTokens: number;
};

export type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number };

/** The reply text, or why there is no usable text (refusal, cut off). */
export type SendResult = ({ ok: true; text: string } | { ok: false; reason: string }) & {
  usage: Usage;
};

export type Adapter = { send(args: SendArgs): Promise<SendResult> };
