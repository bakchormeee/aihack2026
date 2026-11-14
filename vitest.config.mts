import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      // The pure rule folders must be fully covered (SPEC.md, Testing Strategy).
      include: ["src/lib/marking/**", "src/lib/mastery/**"],
      exclude: ["**/*.test.ts"],
      thresholds: { lines: 100 },
    },
  },
});
