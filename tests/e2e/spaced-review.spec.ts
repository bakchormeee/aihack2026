import { expect, test } from "@playwright/test";

import {
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// A marked answer gives its topics a spaced-review schedule, shown in Focus next
// (SPEC-spaced-review.md). The recorded mark is 3/5, partly right: grade Hard, so the
// first review is due one day later.

test.setTimeout(180_000);

/** Tomorrow in UK time, as Focus next writes it, e.g. "16 Nov". */
function tomorrowInLondon(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(tomorrow);
}

test("Focus next shows when a marked topic is next due for review", async ({ page }, info) => {
  await signInAsNewUser(page, "review");
  const { courseUrl, sheetUrl } = await createCourseWithSheet(page, "Review Calculus");

  await openQuestion(page, sheetUrl, "1");
  await submitTypedWorking(page, "By parts, working here.");
  await page.getByRole("link", { name: "See the mark" }).click();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();

  await page.goto(courseUrl);
  const due = `Next review in 1 day (${tomorrowInLondon()})`;
  await expect(page.getByText(due).first()).toBeVisible();
  await expect(page.getByText(`Nothing due. Next review on ${tomorrowInLondon()}.`)).toBeVisible();
  await page.getByText(due).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("focus-next-desktop.png") });

  // It fits a phone screen.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByText(due).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("focus-next-phone.png") });
});
