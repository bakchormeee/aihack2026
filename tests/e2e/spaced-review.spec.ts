import { expect, test } from "@playwright/test";

import {
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// The Topics tab (SPEC-study-views.md) replaces the skill map and Focus next. One marked answer
// (the recorded mark is 3/5) gives a topic one attempt: "Too early to tell", with the
// percentage only in the open row. The spaced-review schedule itself is covered by unit tests;
// the study-views spec shows no due dates.

test.setTimeout(180_000);

test("the Topics tab labels a marked topic and shows its mastery when the row is opened", async ({
  page,
}, info) => {
  await signInAsNewUser(page, "review");
  const { courseUrl, sheetUrl } = await createCourseWithSheet(page, "Review Calculus");

  await openQuestion(page, sheetUrl, "1");
  await submitTypedWorking(page, "By parts, working here.");
  // The mark is on the question page itself: there is no "See the mark" step.
  await expect(page.getByText("3 / 5", { exact: true })).toBeVisible();

  await page.goto(`${courseUrl}/topics`);
  const row = page.getByRole("listitem").filter({ hasText: "Product rule" });
  await expect(row.getByText("Too early to tell")).toBeVisible();
  await expect(page.getByText(/Needs work: below 45%/)).toBeVisible();

  await row.getByRole("button").click();
  await expect(row.getByText(/Mastery \d+% · 1 attempt\b/)).toBeVisible();
  await expect(row.getByRole("link", { name: "Revise", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("topics-desktop.png") });

  // It fits a phone screen.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("topics-phone.png") });
});
