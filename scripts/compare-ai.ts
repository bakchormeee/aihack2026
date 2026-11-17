// Run the same AI inputs through two routes and write the outputs side by side, with tokens
// and cost, to a Markdown file (SPEC-ai-providers.md, "Quality check before switching").
//
//   npx tsx scripts/compare-ai.ts <cases.json> <routeA> <routeB> [out.md]
//
// <cases.json> is a list of cases: [{ "name": "PS2 Q3 marking", "callName": "markAttempt",
// "input": { ...the module's input, as for scripts/try-ai.ts... } }]. File paths are relative
// to the cases file. A route is provider:model[:effort], for example
// openai:gpt-6.2-sol:medium or anthropic:claude-sonnet-5-5:medium.
//
// Makes real requests and costs money: it prints a rough estimate and asks before it starts.
// Keys are read from .env.local. The output file stays local; do not commit it (student work).

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { MODULES, loadCall, loadFiles } from "./ai-input";

type Case = { name: string; callName: string; input: unknown };
type Usage = { inputTokens: number; outputTokens: number; cachedTokens: number };
type Run = { output: string; usage: Usage; requests: number; seconds: number };

/** USD per 1M tokens: input, cached input, output. Read 17 November 2026; update when they change. */
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6.2-astra": { input: 8, cached: 0.8, output: 40 },
  "gpt-6.2-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6.1-terra": { input: 1, cached: 0.1, output: 5 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, cached: 0.1, output: 10 },
  // Prompts of at most 100K tokens; longer prompts cost 5 times as much.
  "claude-haiku-5-5": { input: 0.1, cached: 0.01, output: 0.5 },
};

/** Rough tokens per input, for the estimate only: text ÷ 4, a photo 1,600, a PDF page 3,000. */
const ESTIMATE = { photo: 1600, pdfPage: 3000, pdfBytesPerPage: 100_000, output: 3000 };

function cost(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const fresh = usage.inputTokens - usage.cachedTokens;
  return (
    (fresh * price.input + usage.cachedTokens * price.cached + usage.outputTokens * price.output) /
    1_000_000
  );
}

function money(value: number | null): string {
  return value === null ? "unknown price" : `$${value.toFixed(4)}`;
}

/** Estimated input tokens of one case, from its JSON text and its files. */
function estimateTokens(raw: unknown): number {
  let tokens = 0;
  const walk = (value: unknown, key?: string) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (key === "files" && item && typeof item === "object" && "path" in item) {
          const file = String(item.path).toLowerCase();
          tokens += file.endsWith(".pdf") ? ESTIMATE.pdfPage * 4 : ESTIMATE.photo;
        } else walk(item);
      }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    } else if (typeof value === "string") tokens += Math.ceil(value.length / 4);
  };
  walk(raw);
  return tokens + 1500; // system prompt
}

function parseRoute(value: string): { provider: string; model: string } {
  const [provider, model] = value.split(":");
  if (!["openai", "anthropic"].includes(provider) || !model) {
    throw new Error(`Route must be provider:model[:effort]; got "${value}".`);
  }
  return { provider, model };
}

/** Run one case on one route, collecting the usage lines callAi logs. */
async function runOne(c: Case, route: string, baseDir: string): Promise<Run> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  let requests = 0;
  const original = console.info;
  console.info = (label: unknown, line: unknown) => {
    if (label !== "ai.usage") return original(label, line);
    const logged = JSON.parse(String(line)) as Usage;
    usage.inputTokens += logged.inputTokens;
    usage.outputTokens += logged.outputTokens;
    usage.cachedTokens += logged.cachedTokens;
    requests += 1;
  };
  const variable = `AI_ROUTE_${c.callName}`;
  const before = process.env[variable];
  process.env[variable] = route;
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  try {
    const input = await loadFiles(c.input, baseDir);
    const result = await (await loadCall(c.callName))(input as never);
    return { output: JSON.stringify(result, null, 2), usage, requests, seconds: seconds() };
  } catch (error) {
    return { output: `ERROR: ${(error as Error).message}`, usage, requests, seconds: seconds() };
  } finally {
    console.info = original;
    if (before === undefined) delete process.env[variable];
    else process.env[variable] = before;
  }
}

async function main() {
  const [casesPath, routeA, routeB, outPath = "ai-comparison.md"] = process.argv.slice(2);
  if (!casesPath || !routeA || !routeB) {
    console.error("Usage: npx tsx scripts/compare-ai.ts <cases.json> <routeA> <routeB> [out.md]");
    process.exit(1);
  }
  const routes = [routeA, routeB];
  const models = routes.map((route) => parseRoute(route).model);
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const cases = JSON.parse(await readFile(casesPath, "utf8")) as Case[];
  for (const c of cases) {
    if (!MODULES[c.callName])
      throw new Error(`Case "${c.name}": unknown callName "${c.callName}".`);
  }
  const baseDir = path.dirname(path.resolve(casesPath));

  // Estimate: each case once per route, without retries.
  let estimate = 0;
  for (const c of cases) {
    const usage = {
      inputTokens: estimateTokens(c.input),
      outputTokens: ESTIMATE.output,
      cachedTokens: 0,
    };
    for (const model of models) estimate += cost(model, usage) ?? 0;
  }
  console.log(`${cases.length} cases × 2 routes (${routes.join(" vs ")}).`);
  console.log(`Rough cost estimate: $${estimate.toFixed(2)} (a retry or a long PDF costs more).`);
  for (const model of models) if (!PRICES[model]) console.log(`No price known for ${model}.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Make these real API requests? Type yes to continue: ");
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Nothing was sent.");
    return;
  }

  const totals = routes.map(() => ({ cost: 0, seconds: 0 }));
  let report = `# AI comparison: ${routeA} vs ${routeB}\n\n${new Date().toISOString()}\n\n`;
  for (const c of cases) {
    console.log(`→ ${c.name}`);
    report += `## ${c.name} (\`${c.callName}\`)\n\n`;
    for (const [index, route] of routes.entries()) {
      const run = await runOne(c, route, baseDir);
      const price = cost(models[index], run.usage);
      totals[index].cost += price ?? 0;
      totals[index].seconds += run.seconds;
      report +=
        `### ${route}\n\n` +
        `${run.requests} request(s), ${run.usage.inputTokens} input tokens ` +
        `(${run.usage.cachedTokens} cached), ${run.usage.outputTokens} output tokens, ` +
        `${money(price)}, ${run.seconds.toFixed(1)} s\n\n` +
        "```json\n" +
        run.output +
        "\n```\n\n";
    }
  }
  report +=
    "## Totals\n\n| Route | Cost | Time |\n|---|---|---|\n" +
    routes
      .map(
        (route, i) =>
          `| ${route} | $${totals[i].cost.toFixed(4)} | ${totals[i].seconds.toFixed(0)} s |`,
      )
      .join("\n") +
    "\n";
  await writeFile(outPath, report);
  console.log(`Wrote ${outPath}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
