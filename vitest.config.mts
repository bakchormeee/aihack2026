import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Tests get an in-memory database in place of the real client.
      { find: /^@\/db$/, replacement: path.resolve(import.meta.dirname, "src/db/test-db.ts") },
      { find: /^@\//, replacement: path.resolve(import.meta.dirname, "src") + "/" },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      // The pure rule folders must be fully covered (SPEC.md, Testing Strategy).
      include: [
        "src/lib/marking/**",
        "src/lib/mastery/**",
        "src/lib/spot/**",
        "src/lib/spaced/**",
        "src/lib/demo/**",
        "src/lib/bin/**",
        "src/lib/batch/**",
      ],
      exclude: ["**/*.test.ts"],
      thresholds: { lines: 100 },
    },
  },
});
