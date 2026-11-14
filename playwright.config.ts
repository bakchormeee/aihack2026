import { defineConfig } from "@playwright/test";

// Port 3003 on purpose: uploads go from the browser straight to R2, whose CORS
// rule allows only http://localhost:3000 and http://localhost:3003. 3000 is for
// manual work, so the end-to-end tests use 3003.
const PORT = 3003;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Set E2E_BROWSER_PATH to use a browser you already have instead of the one
    // `npx playwright install` downloads.
    launchOptions: { executablePath: process.env.E2E_BROWSER_PATH || undefined },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // End-to-end tests never call the real Claude API or Google sign-in:
    // AI answers come from tests/fixtures/ai and sign-in uses the test sign-in.
    env: { AI_FIXTURES: "1", ENABLE_TEST_SIGN_IN: "1", NEXT_DIST_DIR: ".next-e2e" },
  },
});
