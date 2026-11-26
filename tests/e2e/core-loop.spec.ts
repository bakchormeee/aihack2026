import { expect, test } from "@playwright/test";

// The core loop of the app, in one browser: sign in, make a course, upload a
// sheet, see it split into questions, use a hint, submit working, see the mark.
// AI answers come from tests/fixtures/ai (AI_FIXTURES=1, see playwright.config.ts).
// It uses the real database and storage with a new test user each run, and a
// tiny generated PDF, so no student work is involved.

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

test("sign in, upload a sheet, use a hint, submit working and see the mark", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;

  // Sign in with the test sign-in (never available in production).
  await page.goto("/sign-in/test");
  await page.getByLabel(/Email/).fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/courses$/);

  // Create a course.
  await page.getByLabel(/New course/).fill("E2E Calculus");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/sheets$/);

  // Upload a sheet; the page opens the sheet and the questions appear once it is read.
  await page.locator('input[type="file"]').setInputFiles({
    name: "Problem Sheet 1.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF,
  });
  await expect(page).toHaveURL(/\/sheets\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Problem Sheet 1" })).toBeVisible();
  await expect(page.getByText("Question 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Question 2(a)", { exact: true })).toBeVisible();

  // Open question 1 and reveal the first hint.
  await page.getByRole("link", { name: /Question 1/ }).click();
  await expect(page).toHaveURL(/\/questions\/[^/]+$/);
  await expect(page.getByText("Hints are being prepared…")).toBeHidden();
  await page.getByRole("button", { name: /Show hint 1/ }).click();
  await expect(page.getByText("Hint 1 · Nudge")).toBeVisible();
  // The second hint is not revealed yet.
  await expect(page.getByText("Hint 2 · Approach")).toBeHidden();

  // Type some working and submit it.
  // The recorded mark quotes these two pieces, so they get boxes on the mark screen.
  const working =
    "By parts, $\\int_0^{\\pi} \\sin x \\, dx = \\big[ \\cos x \\big]_0^{\\pi}$, so the integral is $-2$.";
  await page.getByLabel(/Type it/).fill(working);
  await page.getByRole("button", { name: "Submit working" }).click();
  await expect(page.getByRole("heading", { name: "Your working (submitted)" })).toBeVisible();

  // The mark arrives, labelled as provisional AI marking.
  // The mark is on the question page itself: there is no "See the mark" step.
  await expect(page.getByText("AI-marked, provisional")).toBeVisible();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();
  await expect(page.getByText("Partly right").first()).toBeVisible();

  // The marking scheme is there, with the current score highlighted.
  await page.getByText("How marks out of 5 work").click();
  await expect(page.locator('[aria-current="true"]')).toContainText("Right approach");

  // Each mistake is boxed in the working: red for structural, amber for a careless slip,
  // numbered like the list, and the list carries a hint beside each.
  await expect(page.locator("[data-mistake]")).toHaveCount(2);
  await expect(page.locator('[data-mistake="1"]')).toHaveAttribute("data-severity", "careless");
  await expect(page.locator('[data-mistake="2"]')).toHaveAttribute("data-severity", "structural");
  await expect(page.getByText("Careless slip", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Structural mistake", { exact: false }).first()).toBeVisible();

  // A partial mark does not unlock the worked solution.
  await expect(page.getByRole("heading", { name: "Worked solution" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Retry now" })).toBeVisible();

  // Retrying opens a new draft that starts from the previous working.
  await page.getByRole("button", { name: "Retry now" }).click();
  await expect(page).toHaveURL(/\/questions\/[^/]+$/);
  await expect(page.getByLabel(/Type it/)).toHaveValue(working);
});

test("a signed-out visitor is sent to sign in", async ({ page }) => {
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the test sign-in refuses an address that is not at test.local", async ({ page }) => {
  await page.goto("/sign-in/test");
  await page.getByLabel(/Email/).fill("someone@example.com");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/courses$/);
});
