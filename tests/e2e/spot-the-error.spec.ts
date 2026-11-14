import { expect, test, type Page } from "@playwright/test";

import {
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// A student gets an answer marked, sees their common errors on the Revise page, runs a
// five-question spot-the-error session, and the answers count towards mastery.
// AI answers come from tests/fixtures/ai (AI_FIXTURES=1): the grouping call returns two
// misconceptions; the exercises come in three recorded kinds (one planted error on line 3,
// two planted errors on lines 1 and 4, and a clean solution), dealt in a random order.

test.setTimeout(240_000);

async function answerCurrentQuestion(page: Page): Promise<"one" | "two" | "clean"> {
  // Tell the three kinds apart by the plain word that starts each question, not by its
  // maths, whose rendered text depends on KaTeX.
  const body = await page.locator("main, body").first().innerText();
  if (body.includes("Solve")) {
    await page.getByRole("button", { name: "No error" }).click();
    await page.getByRole("button", { name: "Submit answer" }).click();
    return "clean";
  }
  if (body.includes("Differentiate")) {
    // Two errors planted: find only the first one.
    await page.getByLabel("Line 1 is wrong").check();
    await page
      .getByLabel("What is wrong in line 1?")
      .fill("The sign before the second term should be plus.");
    await page.getByRole("button", { name: "Submit answer" }).click();
    return "two";
  }
  await page.getByLabel("Line 3 is wrong").check();
  await page
    .getByLabel("What is wrong in line 3?")
    .fill("The minus sign should change both terms in the bracket.");
  await page.getByRole("button", { name: "Submit answer" }).click();
  return "one";
}

test("common errors, a spot-the-error session, the reveal, the summary and mastery", async ({
  page,
}) => {
  await signInAsNewUser(page, "spot");
  const { courseUrl, sheetUrl } = await createCourseWithSheet(page, "Spot Calculus");

  // Get one answer marked: its mistakes become the student's common errors.
  await openQuestion(page, sheetUrl, "1");
  await submitTypedWorking(page, "By parts, working here.");
  await page.getByRole("link", { name: "See the mark" }).click();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();

  // Mastery of the topic before any spot-the-error answer.
  await page.goto(courseUrl);
  await page.getByRole("link", { name: /Product rule/ }).click();
  await expect(page.getByText(/Mastery \d+% from 1 attempt\b/)).toBeVisible();

  // The Revise page offers both kinds, and Spot the error shows the common errors.
  await page.goto("/revise");
  await expect(page.getByRole("button", { name: "Start revision" })).toBeVisible();
  await page.getByRole("button", { name: "Spot the error" }).click();
  await expect(page.getByRole("heading", { name: "Your common errors" })).toBeVisible();
  await expect(page.getByText("Seen once").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Not me" })).toHaveCount(2);

  // It fits a phone screen.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Start a session of 5 questions.
  await page.getByRole("button", { name: "5 questions", exact: true }).click();
  await page.getByRole("button", { name: "Start spot the error" }).click();
  await expect(page).toHaveURL(/\/revise\/[^/]+$/);
  const sessionUrl = page.url();
  await expect(page.getByText("0 of 5 answered.")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/spot\/1$/);

  const kinds: string[] = [];
  let revealChecked = false;
  for (let position = 1; position <= 5; position++) {
    await expect(page).toHaveURL(new RegExp(`/spot/${position}$`));
    await expect(
      page.getByRole("heading", { name: new RegExp(`question ${position} of 5`) }),
    ).toBeVisible();
    const kind = await answerCurrentQuestion(page);
    kinds.push(kind);

    // The reveal: the planted errors, their corrections and the common error behind each.
    await expect(page.getByText(/^(Correct|Partly right|Stuck)$/).first()).toBeVisible({
      timeout: 60_000,
    });
    if (kind === "one" && !revealChecked) {
      revealChecked = true;
      await expect(page.getByText("You found this")).toBeVisible();
      await expect(page.getByText("Correct line")).toBeVisible();
      await expect(page.getByText(/Based on your common error/)).toBeVisible();
      await expect(page.getByText("Your explanation", { exact: true })).toBeVisible();
    }
    if (kind === "clean") await expect(page.getByText("This solution had no error.")).toBeVisible();
    if (kind === "two") {
      await expect(page.getByText("You did not tick this line")).toBeVisible();
      await expect(page.getByText("Partly right")).toBeVisible();
    }
    await page.getByRole("link", { name: position < 5 ? "Next question" : "Finish" }).click();
  }

  // The session page ends with a summary: three single-error answers and the clean one are
  // correct, the two-error one is partly right and names the common error that was missed.
  await expect(page).toHaveURL(sessionUrl);
  const full = kinds.filter((k) => k !== "two").length;
  const partial = kinds.filter((k) => k === "two").length;
  await expect(page.getByLabel("Summary")).toContainText(
    `${full} correct, ${partial} partly right, 0 stuck.`,
  );
  if (partial > 0) await expect(page.getByText("Common errors you missed this time")).toBeVisible();

  // A question that is already answered shows its reveal and no form.
  await page.goto(`${sessionUrl}/spot/1`);
  await expect(page.getByRole("button", { name: "Submit answer" })).toHaveCount(0);
  await expect(page.getByText(/^(Correct|Partly right|Stuck)$/).first()).toBeVisible();

  // The answers count on the topic: one marked attempt plus five spot-the-error answers.
  await page.goto(courseUrl);
  await page.getByRole("link", { name: /Product rule/ }).click();
  await expect(page.getByText(/Mastery \d+% from 6 attempts/)).toBeVisible();

  // Phone width for the session page and a question.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const url of [sessionUrl, `${sessionUrl}/spot/1`]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  }
});

test("a question of someone else's session or a missing one is not found", async ({ page }) => {
  await signInAsNewUser(page, "spot-404");

  await page.goto("/revise/not-a-session/spot/1");

  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit answer" })).toHaveCount(0);
});
