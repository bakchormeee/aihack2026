// Shared by scripts/try-ai.ts and scripts/compare-ai.ts: which module holds each AI call, and
// how to read a module's input from JSON (files written as { "path": "sheet.pdf" }).

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

/** callName → file in src/lib/ai that exports a function of the same name. */
export const MODULES: Record<string, string> = {
  parseSheet: "parse-sheet",
  generateHints: "generate-hints",
  markAttempt: "mark-attempt",
  extractSolutions: "extract-solutions",
  generateVariant: "generate-variant",
  summariseSheet: "summarise-sheet",
  matchWorking: "match-working",
  judgeSpotAnswer: "judge-spot-answer",
  groupMisconceptions: "group-misconceptions",
  writeFlawedSolution: "write-flawed-solution",
};

type Call = (input: never) => Promise<unknown>;

/** The module function for `callName`. */
export async function loadCall(callName: string): Promise<Call> {
  const moduleName = MODULES[callName];
  if (!moduleName) throw new Error(`Unknown callName "${callName}".`);
  const loaded: Record<string, unknown> = await import(`../src/lib/ai/${moduleName}.ts`);
  return loaded[callName] as Call;
}

/** Replace every { path } entry of every `files` array with { mime, data }. */
export async function loadFiles(value: unknown, baseDir: string, key?: string): Promise<unknown> {
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
