// Run one real AI call for a manual check.
//
//   npx tsx scripts/try-ai.ts <callName> <input.json>
//
// <callName> is one of the modules in src/lib/ai (parseSheet, generateHints,
// markAttempt, extractSolutions, generateVariant, summariseSheet). <input.json>
// holds the module's input. Wherever the input has a `files` array, write each
// file as { "path": "relative/or/absolute/file.pdf" }; the script reads the
// bytes and works out the type from the extension.
//
// Uses the call's route (src/lib/ai/routes.ts): OPENAI_API_KEY for openai, ANTHROPIC_API_KEY for
// anthropic, read from .env.local when present. Prints the route first. Costs money.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

type Call = (input: never) => Promise<unknown>;

/** Modules are loaded by name so that the script works before all of them exist. */
const MODULES: Record<string, string> = {
  parseSheet: "parse-sheet",
  generateHints: "generate-hints",
  markAttempt: "mark-attempt",
  extractSolutions: "extract-solutions",
  generateVariant: "generate-variant",
  summariseSheet: "summarise-sheet",
};

/** Replace every { path } entry of every `files` array with { mime, data }. */
async function loadFiles(value: unknown, baseDir: string, key?: string): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map(async (item) => {
        if (key === "files" && item && typeof item === "object" && "path" in item) {
          const file = path.resolve(baseDir, String(item.path));
          const mime = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
          if (!mime) throw new Error(`Unknown file type: ${file}`);
          return { mime, data: await readFile(file) };
        }
        return loadFiles(item, baseDir);
      }),
    );
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([k, v]) => [k, await loadFiles(v, baseDir, k)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function main() {
  const [callName, inputPath] = process.argv.slice(2);
  const moduleName = MODULES[callName ?? ""];
  if (!moduleName || !inputPath) {
    console.error(`Usage: npx tsx scripts/try-ai.ts <callName> <input.json>`);
    console.error(`callName: ${Object.keys(MODULES).join(", ")}`);
    process.exit(1);
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const { routeFor } = await import("../src/lib/ai/routes.ts");
  const route = routeFor(callName);
  console.error(`${callName} → ${route.provider} ${route.model} (effort ${route.effort})`);

  const loaded: Record<string, unknown> = await import(`../src/lib/ai/${moduleName}.ts`);
  const call = loaded[callName] as Call;
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
