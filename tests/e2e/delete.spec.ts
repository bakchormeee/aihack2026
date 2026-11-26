import { expect, test } from "@playwright/test";

import { createCourseWithSheet, signInAsNewUser } from "./helpers";

// Deleting (SPEC-delete.md): a sheet and then a course go to Recently deleted, are
// hidden everywhere, and can be restored. AI answers come from tests/fixtures/ai.

test.use({ viewport: { width: 375, height: 812 } });

async function noSidewaysScroll(page: import("@playwright/test").Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
}

test("delete a sheet, restore it, then delete the course", async ({ page }) => {
  await signInAsNewUser(page, "e2e-delete");
  const courseName = `E2E Delete ${Date.now()}`;
  const { courseUrl, sheetUrl } = await createCourseWithSheet(page, courseName);

  // The course page lists its sheet, so the empty state is hidden.
  await page.goto(courseUrl);
  await expect(page.getByText("Upload your first problem sheet")).toBeHidden();

  // Delete the sheet: the dialog says what goes with it.
  await page.goto(sheetUrl);
  await page.getByRole("button", { name: "Delete sheet" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This deletes Problem Sheet 1 with its 4 questions");
  await expect(dialog).toContainText("restore it from Recently deleted for 30 days");
  await noSidewaysScroll(page);
  await dialog.getByRole("button", { name: "Delete" }).click();

  // Back on the course: the notice shows and the empty state is back.
  await expect(page).toHaveURL(new RegExp(`${courseUrl}\\?deleted=1$`));
  await expect(page.getByText("Moved to Recently deleted.")).toBeVisible();
  await expect(page.getByText("Upload your first problem sheet")).toBeVisible();

  // The sheet's own page is gone.
  await page.goto(sheetUrl);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();

  // Recently deleted lists it with its course, and Restore brings it back.
  await page.goto("/courses");
  await page.getByRole("link", { name: "Recently deleted" }).click();
  await expect(page).toHaveURL(/\/courses\/deleted$/);
  await expect(page.getByText("Problem Sheet 1", { exact: true })).toBeVisible();
  await expect(page.getByText(`${courseName} · Deleted on`)).toBeVisible();
  await expect(page.getByText(/Erased on/)).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Problem Sheet 1", { exact: true })).toBeHidden();

  await page.goto(sheetUrl);
  await expect(page.getByText("Question 2(a)", { exact: true })).toBeVisible();
  await page.goto(courseUrl);
  await expect(page.getByText("Upload your first problem sheet")).toBeHidden();

  // Delete the whole course: it leaves the courses list and waits in Recently deleted.
  await page.getByRole("button", { name: "Delete course" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    new RegExp(`This deletes ${courseName} with its 1 sheet(,| and) 4 questions`),
  );
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/courses\?deleted=1$/);
  await expect(page.getByText("Moved to Recently deleted.")).toBeVisible();
  await expect(page.getByRole("link", { name: courseName })).toBeHidden();
  await noSidewaysScroll(page);

  await page.goto(sheetUrl);
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();

  await page.goto("/courses/deleted");
  await expect(page.getByText(courseName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.goto("/courses");
  await expect(page.getByRole("link", { name: new RegExp(courseName) })).toBeVisible();
});
