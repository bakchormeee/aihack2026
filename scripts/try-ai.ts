// Run one real AI call for a manual check.
//
//   npx tsx scripts/try-ai.ts <callName> <input.json>
//
// <callName> is one of the modules in src/lib/ai (see MODULES in scripts/ai-input.ts). <input.json>
// holds the module's input. Wherever the input has a `files` array, write each
// file as { "path": "relative/or/absolute/file.pdf" }; the script reads the
// bytes and works out the type from the extension.
//
// Uses the call's route (src/lib/ai/routes.ts): OPENAI_API_KEY for openai, ANTHROPIC_API_KEY for
// anthropic, read from .env.local when present. Prints the route first. Costs money.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { routeFor } from "../src/lib/ai/routes";
import { MODULES, loadCall, loadFiles } from "./ai-input";

async function main() {
  const [callName, inputPath] = process.argv.slice(2);
  if (!MODULES[callName ?? ""] || !inputPath) {
    console.error(`Usage: npx tsx scripts/try-ai.ts <callName> <input.json>`);
    console.error(`callName: ${Object.keys(MODULES).join(", ")}`);
    process.exit(1);
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const route = routeFor(callName);
  console.error(`${callName} → ${route.provider} ${route.model} (effort ${route.effort})`);

  const call = await loadCall(callName);
  const raw: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  const input = await loadFiles(raw, path.dirname(path.resolve(inputPath)));

  const started = Date.now();
  const result = await call(input as never);
  console.log(JSON.stringify(result, null, 2));
  console.error(`\n${callName} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
