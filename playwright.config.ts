import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    // End-to-end tests never call the real Claude API or Google sign-in.
    env: { AI_FIXTURES: "1", ENABLE_TEST_SIGN_IN: "1" },
  },
});
