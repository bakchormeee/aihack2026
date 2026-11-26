import { expect, test, type Page } from "@playwright/test";

import { createCourseWithSheet, openQuestion, signInAsNewUser } from "./helpers";

// Working for several questions at once (SPEC-batch-working.md). The matching answer is
// tests/fixtures/ai/matchWorking.json: questions 1, 2(a), 2(b) (over both photos), 3,
// and one part that is not matched. The photos are drawn in the browser, so no student
// work is used.

test.use({ viewport: { width: 375, height: 812 } });

async function drawnPhoto(page: Page, name: string, lines: string[]) {
  const base64 = await page.evaluate((text) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.font = "48px sans-serif";
    text.forEach((line, i) => ctx.fillText(line, 60, 120 + i * 360));
    return canvas.toDataURL("image/png").split(",")[1];
  }, lines);
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function noSidewaysScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
}

async function uploadPhotos(page: Page, sheetUrl: string) {
  await page.goto(sheetUrl);
  await page.getByRole("link", { name: "Upload working for several questions" }).click();
  await expect(page).toHaveURL(/\/batch$/);
  await page.waitForLoadState("networkidle");
  await page
    .getByLabel("Choose photos")
    .setInputFiles([
      await drawnPhoto(page, "page-1.png", ["1. x = 2", "2(a) by parts", "2(b) start"]),
      await drawnPhoto(page, "page-2.png", ["2(b) end", "3. so n = 4", "scribble"]),
    ]);
  await expect(page.getByText("Photo 2: page-2.png")).toBeVisible();
  await page.getByRole("button", { name: "Upload and match" }).click();
  await expect(page.getByRole("button", { name: "Submit and mark" })).toBeVisible({
    timeout: 60_000,
  });
}

test("upload two photos for four questions, correct a part, submit and see the marks", async ({
  page,
}) => {
  await signInAsNewUser(page, "e2e-batch");
  const { sheetUrl } = await createCourseWithSheet(page, `E2E Batch ${Date.now()}`);

  // Cancel first: back to the sheet, and nothing was submitted.
  await uploadPhotos(page, sheetUrl);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(new RegExp(`${sheetUrl}$`));
  await openQuestion(page, sheetUrl, "1");
  await expect(page.getByRole("heading", { name: "Your working (submitted)" })).toBeHidden();

  // Now for real: the review shows the four questions and the part that was not matched.
  await uploadPhotos(page, sheetUrl);
  for (const label of ["1", "2(a)", "2(b)", "3"])
    await expect(
      page.getByRole("heading", { name: `Question ${label}`, exact: true }),
    ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Not matched", exact: true })).toBeVisible();
  // 2(b)'s working runs over both photos, in order.
  await expect(page.getByText("Part 2 · photo 2", { exact: true })).toBeVisible();
  await noSidewaysScroll(page);

  // Correct one part: give the unmatched part to question 3.
  await page.getByLabel("Question for this part").last().selectOption({ label: "Question 3" });
  await expect(page.getByRole("heading", { name: "Not matched", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Submit and mark" }).click();
  await expect(page).toHaveURL(new RegExp(`${sheetUrl}$`), { timeout: 60_000 });

  // Each question was submitted and gets a mark.
  for (const label of ["1", "3"]) {
    await openQuestion(page, sheetUrl, label);
    await expect(page.getByText("AI-marked, provisional")).toBeVisible();
  }

  // With every question submitted, there is nothing left to match.
  await page.goto(`${sheetUrl}/batch`);
  await expect(page.getByText(/already has submitted working/)).toBeVisible();
});
