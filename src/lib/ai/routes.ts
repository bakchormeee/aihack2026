// Which provider, model and effort each AI call uses (SPEC-ai-providers.md, "A route per call").
// Model ids live here and in environment variables, nowhere else.

export const PROVIDERS = ["openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Effort levels that both providers accept. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type Route = { provider: Provider; model: string; effort: Effort };
export type Tier = "strong" | "cheap";

type Env = Record<string, string | undefined>;

/** Short, text-only calls whose weaker answers are visible and low-harm. Every other call is strong. */
export const CHEAP_CALLS: ReadonlySet<string> = new Set([
  "summariseSheet",
  "judgeSpotAnswer",
  "groupMisconceptions",
]);

const DEFAULTS: Record<Provider, Record<Tier, { model: string; effort: Effort }>> = {
  openai: {
    strong: { model: "gpt-6.2-sol", effort: "medium" },
    cheap: { model: "gpt-6-luna", effort: "low" },
  },
  anthropic: {
    strong: { model: "claude-sonnet-5-5", effort: "medium" },
    cheap: { model: "claude-haiku-5-5", effort: "low" },
  },
};

const DEFAULT_MAX_TOKENS = 16000;

/** A routing variable has a value that cannot be used. */
export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

export function tierOf(callName: string): Tier {
  return CHEAP_CALLS.has(callName) ? "cheap" : "strong";
}

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function provider(value: string, variable: string): Provider {
  if ((PROVIDERS as readonly string[]).includes(value)) return value as Provider;
  throw new AiConfigError(`${variable} must be one of ${PROVIDERS.join(", ")}; got "${value}".`);
}

function effort(value: string, variable: string): Effort {
  if ((EFFORTS as readonly string[]).includes(value)) return value as Effort;
  throw new AiConfigError(`${variable} must be one of ${EFFORTS.join(", ")}; got "${value}".`);
}

/**
 * The route of one call, from (highest first):
 * 1. `AI_ROUTE_<callName>` = `provider:model[:effort]`
 * 2. `AI_MODEL_STRONG` / `AI_MODEL_CHEAP`, `AI_EFFORT_STRONG` / `AI_EFFORT_CHEAP`
 * 3. the old `AI_MODEL` / `AI_EFFORT`: strong tier, and only with Claude (they held Claude ids)
 * 4. the defaults above, for `AI_PROVIDER` (default `openai`).
 * A value that cannot be used throws `AiConfigError` naming the variable.
 */
export function routeFor(callName: string, env: Env = process.env): Route {
  const tier = tierOf(callName);
  const tierName = tier.toUpperCase();
  const providerValue = read(env, "AI_PROVIDER");
  const base = providerValue ? provider(providerValue, "AI_PROVIDER") : "openai";
  const legacy = base === "anthropic" && tier === "strong";

  const effortVariable = read(env, `AI_EFFORT_${tierName}`)
    ? `AI_EFFORT_${tierName}`
    : legacy && read(env, "AI_EFFORT")
      ? "AI_EFFORT"
      : null;
  const tierEffort = effortVariable
    ? effort(read(env, effortVariable)!, effortVariable)
    : DEFAULTS[base][tier].effort;

  const overrideName = `AI_ROUTE_${callName}`;
  const override = read(env, overrideName);
  if (override) {
    const parts = override.split(":").map((part) => part.trim());
    if (parts.length < 2 || parts.length > 3 || !parts[1]) {
      throw new AiConfigError(
        `${overrideName} must look like "provider:model" or "provider:model:effort"; got "${override}".`,
      );
    }
    return {
      provider: provider(parts[0], overrideName),
      model: parts[1],
      effort: parts[2] ? effort(parts[2], overrideName) : tierEffort,
    };
  }

  const model =
    read(env, `AI_MODEL_${tierName}`) ??
    (legacy ? read(env, "AI_MODEL") : undefined) ??
    DEFAULTS[base][tier].model;
  return { provider: base, model, effort: tierEffort };
}

/** Output token limit for every call: `AI_MAX_TOKENS`, default 16000. */
export function maxTokens(env: Env = process.env): number {
  const value = Number(env.AI_MAX_TOKENS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_TOKENS;
}
