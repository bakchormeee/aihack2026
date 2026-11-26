import { expect, type Page } from "@playwright/test";

// A tiny valid-looking PDF, so no student work is ever used in tests.
export const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
);

export async function signInAsNewUser(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}@test.local`;
  await page.goto("/sign-in/test");
  await page.getByLabel(/Email/).fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  return email;
}

/** Creates a course and uploads a sheet. AI answers come from tests/fixtures/ai: 4 questions (1, 2(a), 2(b), 3). */
export async function createCourseWithSheet(
  page: Page,
  courseName: string,
): Promise<{ courseUrl: string; sheetUrl: string }> {
  await page.getByLabel(/New course/).fill(courseName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/sheets$/);
  const courseUrl = page.url().replace(/\/sheets$/, "");

  await page.locator('input[type="file"]').setInputFiles({
    name: "Problem Sheet 1.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF,
  });
  await expect(page).toHaveURL(/\/sheets\/[^/]+$/);
  await expect(page.getByText("Question 2(a)", { exact: true })).toBeVisible();
  // Wait until the hints of every question are ready.
  await expect(page.getByText("Hints being prepared…")).toHaveCount(0, { timeout: 60_000 });
  return { courseUrl, sheetUrl: page.url() };
}

export async function openQuestion(page: Page, sheetUrl: string, label: string) {
  await page.goto(sheetUrl);
  // The link's name starts with "Question <label>" followed by a space; \b would not match after ")".
  const escaped = label.replace(/[()]/g, "\\$&");
  await page.getByRole("link", { name: new RegExp(`^Question ${escaped}(\\s|$)`) }).click();
  await expect(page).toHaveURL(/\/questions\/[^/?]+$/);
}

export async function submitTypedWorking(page: Page, text: string) {
  await page.getByLabel(/Type it/).fill(text);
  await page.getByRole("button", { name: "Submit working" }).click();
  await expect(page.getByRole("heading", { name: "Your working (submitted)" })).toBeVisible();
}
