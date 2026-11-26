import { expect, test, type Page } from "@playwright/test";

import {
  MINIMAL_PDF,
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// SPEC-study-views.md end to end: the Mark with AI now switch and waiting, the score of what was
// attempted, the status on each question, the mark in place with an attempt timeline, official
// solutions winning. AI answers come from tests/fixtures/ai, so every mark is 3/5.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let page: Page;
let courseUrl = "";
let sheetUrl = "";

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, "views");
  ({ courseUrl, sheetUrl } = await createCourseWithSheet(page, "Views Calculus"));
});

test.afterAll(async () => {
  await page.context().close();
});

test("a sheet with nothing marked says so above its tabs", async () => {
  await page.goto(sheetUrl);
  await expect(page.getByText(/Attempted 0 of 3 questions/)).toBeVisible();
  await page.goto(courseUrl);
  await expect(page.getByRole("link", { name: "Sheets" }).first()).toBeVisible();
});

test("with the switch off a submission waits and is not counted", async () => {
  await openQuestion(page, sheetUrl, "1");
  const aiSwitch = page.getByRole("switch", { name: "Mark with AI now" });
  await expect(aiSwitch).toBeChecked();
  await expect(page.getByText("The AI marks it in about a minute.")).toBeVisible();
  await aiSwitch.click();
  await expect(aiSwitch).not.toBeChecked();
  await expect(
    page.getByText("Not marked until the official solutions are uploaded."),
  ).toBeVisible();
  await submitTypedWorking(page, "My working for question 1");
  await expect(page.getByText("Marked when the official solutions are uploaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark with AI instead" })).toBeVisible();

  await page.goto(sheetUrl);
  await expect(page.getByText("Waiting for official solution").first()).toBeVisible();
  await expect(page.getByText(/Attempted 0 of 3 questions/)).toBeVisible();
});

test("the switch keeps its position for the sheet", async () => {
  await openQuestion(page, sheetUrl, "3");
  await expect(page.getByRole("switch", { name: "Mark with AI now" })).not.toBeChecked();
  await expect(
    page.getByText("Not marked until the official solutions are uploaded."),
  ).toBeVisible();
});

test("an AI-marked part shows its mark on the question page and counts in the score", async () => {
  await openQuestion(page, sheetUrl, "2(a)");
  // The switch starts where it was last used on this sheet (off); turn it on for this one.
  const aiSwitch = page.getByRole("switch", { name: "Mark with AI now" });
  await expect(aiSwitch).not.toBeChecked();
  await aiSwitch.click();
  await submitTypedWorking(page, "My working for 2(a)");
  // The mark is on the question page itself: no extra click.
  await expect(page.getByText(/3 \/ 5/).first()).toBeVisible({ timeout: 90_000 });

  await page.goto(sheetUrl);
  await expect(page.getByText(/attempted 1 of 3 questions/i)).toBeVisible();
  await expect(page.getByText(/3 \/ 5/).first()).toBeVisible();
});

test("a second attempt adds a timeline, and the newest is the one shown", async () => {
  await openQuestion(page, sheetUrl, "2(a)");
  await page.getByRole("button", { name: "Start a new attempt" }).click();
  await submitTypedWorking(page, "Second try at 2(a)");
  await expect(page.getByText(/3 \/ 5/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: /^Attempt 1,/ })).toBeVisible();
  await page.getByRole("link", { name: /^Attempt 1,/ }).click();
  await expect(page).toHaveURL(/attempt=/);
  await expect(page.getByText("My working for 2(a)")).toBeVisible();
});

test("uploading the official solutions marks the waiting submission against them", async () => {
  await page.goto(`${sheetUrl}/solutions`);
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Solutions.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF,
  });
  await expect(page.getByRole("heading", { name: "Still to get right" })).toBeVisible({
    timeout: 90_000,
  });

  await openQuestion(page, sheetUrl, "1");
  await expect(page.getByText("Marked when the official solutions are uploaded.")).toHaveCount(0);
  await expect(page.getByText(/3 \/ 5/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Official solution").first()).toBeVisible();

  // With official solutions the switch is locked on a new question's page.
  await openQuestion(page, sheetUrl, "3");
  await expect(page.getByText("Marked against the official solution")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Mark with AI now" })).toBeDisabled();
});

test("the new screens fit a phone", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const url of [courseUrl, `${courseUrl}/topics`, sheetUrl, `${sheetUrl}/batch`]) {
    await page.goto(url);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
  await openQuestion(page, sheetUrl, "2(a)");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
