import { describe, expect, it } from "vitest";

import { AiConfigError, CHEAP_CALLS, maxTokens, routeFor, tierOf } from "./routes";

describe("tierOf", () => {
  it("puts the short text-only calls in the cheap tier", () => {
    expect(tierOf("summariseSheet")).toBe("cheap");
    expect(tierOf("judgeSpotAnswer")).toBe("cheap");
    expect(tierOf("groupMisconceptions")).toBe("cheap");
    expect([...CHEAP_CALLS].sort()).toEqual([
      "groupMisconceptions",
      "judgeSpotAnswer",
      "summariseSheet",
    ]);
  });

  it("puts every other call, known or not, in the strong tier", () => {
    for (const name of [
      "parseSheet",
      "extractSolutions",
      "markAttempt",
      "matchWorking",
      "generateHints",
      "generateVariant",
      "writeFlawedSolution",
      "writeFlawedSolutionTwo",
      "writeCleanSolution",
      "somethingNew",
    ])
      expect(tierOf(name)).toBe("strong");
  });
});

describe("routeFor", () => {
  it("uses OpenAI by default, with a strong and a cheap model", () => {
    expect(routeFor("markAttempt", {})).toEqual({
      provider: "openai",
      model: "gpt-6.2-sol",
      effort: "medium",
    });
    expect(routeFor("summariseSheet", {})).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
      effort: "low",
    });
  });

  it("uses Claude models when the provider is anthropic", () => {
    const env = { AI_PROVIDER: "anthropic" };
    expect(routeFor("markAttempt", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "medium",
    });
    expect(routeFor("judgeSpotAnswer", env)).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "low",
    });
  });

  it("reads each tier's model and effort", () => {
    const env = {
      AI_MODEL_STRONG: "strong-model",
      AI_MODEL_CHEAP: "cheap-model",
      AI_EFFORT_STRONG: "high",
      AI_EFFORT_CHEAP: "medium",
    };
    expect(routeFor("parseSheet", env)).toEqual({
      provider: "openai",
      model: "strong-model",
      effort: "high",
    });
    expect(routeFor("groupMisconceptions", env)).toEqual({
      provider: "openai",
      model: "cheap-model",
      effort: "medium",
    });
  });

  it("applies the old AI_MODEL and AI_EFFORT to the strong tier with Claude only", () => {
    const old = { AI_MODEL: "claude-opus-5-5", AI_EFFORT: "high" };
    expect(routeFor("markAttempt", { ...old, AI_PROVIDER: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
      effort: "high",
    });
    expect(routeFor("summariseSheet", { ...old, AI_PROVIDER: "anthropic" }).model).toBe(
      "claude-haiku-5-5",
    );
    // A Claude model id must never be sent to OpenAI.
    expect(routeFor("markAttempt", old)).toEqual({
      provider: "openai",
      model: "gpt-6.2-sol",
      effort: "medium",
    });
  });

  it("lets the tier variables win over the old ones", () => {
    const env = { AI_PROVIDER: "anthropic", AI_MODEL: "old", AI_MODEL_STRONG: "new" };
    expect(routeFor("markAttempt", env).model).toBe("new");
  });

  it("overrides one call with AI_ROUTE_<callName>", () => {
    const env = { AI_ROUTE_markAttempt: "anthropic:claude-sonnet-5-5:high" };
    expect(routeFor("markAttempt", env)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      effort: "high",
    });
    expect(routeFor("parseSheet", env).provider).toBe("openai");
  });

  it("takes the tier's effort when an override gives none", () => {
    expect(routeFor("summariseSheet", { AI_ROUTE_summariseSheet: "openai:gpt-6.2-sol" })).toEqual(
      { provider: "openai", model: "gpt-6.2-sol", effort: "low" },
    );
  });

  it("names the variable when a value is not valid", () => {
    expect(() => routeFor("markAttempt", { AI_PROVIDER: "gemini" })).toThrow(/AI_PROVIDER/);
    expect(() => routeFor("markAttempt", { AI_EFFORT_STRONG: "extreme" })).toThrow(
      /AI_EFFORT_STRONG/,
    );
    expect(() => routeFor("markAttempt", { AI_ROUTE_markAttempt: "openai" })).toThrow(
      /AI_ROUTE_markAttempt/,
    );
    expect(() => routeFor("markAttempt", { AI_ROUTE_markAttempt: "x:y:low" })).toThrow(
      /AI_ROUTE_markAttempt/,
    );
    expect(() => routeFor("markAttempt", { AI_ROUTE_markAttempt: "openai::low" })).toThrow(
      /AI_ROUTE_markAttempt/,
    );
    expect(() => routeFor("markAttempt", { AI_ROUTE_markAttempt: "openai:m:huge" })).toThrow(
      AiConfigError,
    );
  });

  it("ignores empty variables", () => {
    expect(routeFor("markAttempt", { AI_PROVIDER: "", AI_MODEL_STRONG: "", AI_EFFORT_STRONG: "" }))
      .toEqual({ provider: "openai", model: "gpt-6.2-sol", effort: "medium" });
  });
});

describe("maxTokens", () => {
  it("reads AI_MAX_TOKENS and defaults to 16000", () => {
    expect(maxTokens({})).toBe(16000);
    expect(maxTokens({ AI_MAX_TOKENS: "8000" })).toBe(8000);
    expect(maxTokens({ AI_MAX_TOKENS: "-3" })).toBe(16000);
    expect(maxTokens({ AI_MAX_TOKENS: "abc" })).toBe(16000);
  });
});
