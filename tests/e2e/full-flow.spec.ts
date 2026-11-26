import { expect, test, type Page } from "@playwright/test";

import {
  MINIMAL_PDF,
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// One signed-in student works through the parts of the app that the core-loop
// test does not reach. The tests run in order and share the data of the ones
// before them (a course, a sheet, a marked attempt, ...). AI answers come from
// tests/fixtures/ai, so every mark is 3/5 (partly right).

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let page: Page;
let courseUrl = "";
let sheetUrl = "";
let questionUrl = "";
let markUrl = "";

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signInAsNewUser(page, "flow");
  ({ courseUrl, sheetUrl } = await createCourseWithSheet(page, "Flow Calculus"));
});

test.afterAll(async () => {
  await page.context().close();
});

test("hints reveal strictly in order, and the third one unlocks the worked solution", async () => {
  await openQuestion(page, sheetUrl, "1");
  await expect(page.getByRole("heading", { name: "Worked solution" })).toBeHidden();

  await page.getByRole("button", { name: /Show hint 1/ }).click();
  await expect(page.getByText("Hint 1 · Nudge")).toBeVisible();
  await expect(page.getByText("Hint 2 · Approach")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Worked solution" })).toBeHidden();

  await page.getByRole("button", { name: /Show hint 2/ }).click();
  await expect(page.getByText("Hint 2 · Approach")).toBeVisible();
  await expect(page.getByText("Hint 3 · Skeleton")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Worked solution" })).toBeHidden();

  await page.getByRole("button", { name: /Show hint 3/ }).click();
  await expect(page.getByText("Hint 3 · Skeleton")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worked solution" })).toBeVisible();
  // All three hints are used up: there is no fourth button.
  await expect(page.getByRole("button", { name: /Show hint/ })).toHaveCount(0);
});

test("a mark can be disputed twice, keeping every earlier mark, and then no more", async () => {
  await openQuestion(page, sheetUrl, "2(a)");
  questionUrl = page.url();
  await submitTypedWorking(page, "Integrating by parts, the integral is $-2$.");
  await page.getByRole("link", { name: "See the mark" }).click();
  await expect(page.getByText("3/5", { exact: true })).toBeVisible();
  markUrl = page.url();

  const dispute = page.getByRole("button", { name: "I think this is right" });
  await page
    .getByLabel(/Do you think your working is right/)
    .fill("I used integration by parts correctly");
  await dispute.click();
  await expect(page.getByText("All marks for this attempt")).toBeVisible();
  await expect(page.getByText(/you disputed this/)).toBeVisible();
  await expect(page.getByText("Your reason: I used integration by parts correctly")).toBeVisible();

  await page.getByRole("button", { name: "I think this is right" }).click();
  await expect(
    page.getByText("You have asked for this attempt to be looked at again twice."),
  ).toBeVisible();
  // The limit is enforced: no way to ask a third time.
  await expect(page.getByRole("button", { name: "I think this is right" })).toHaveCount(0);
  // Three marks are kept in the history of the attempt (the first and two disputes).
  await expect(page.getByText(/3\/5 · Partly right/)).toHaveCount(3);
});

test("uploading the official solutions re-marks the answers and shows the review", async () => {
  await page.goto(`${sheetUrl}/solutions`);
  // Let the page finish loading its scripts before a file is handed to it.
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Solutions.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF,
  });
  // The review appears once the solutions are read and the answers re-marked.
  await expect(page.getByRole("heading", { name: "Still to get right" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText(/Integrating by parts with/).first()).toBeVisible();

  // The mark screen now says the mark is against the official solutions.
  await page.goto(markUrl);
  await expect(page.getByText("AI-marked against the official solutions")).toBeVisible();
});

test("history lists the attempts and the hand-in export downloads a PDF", async () => {
  await page.goto(`${sheetUrl}/history`);
  await expect(page.getByText("Question 2(a)").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Try again/ }).first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export hand-in PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
  // The hand-in carries the student's working only: no marks, hints or feedback text.
  // (Typed working is drawn as an image, so any text in the file would be added by the export itself.)
  const raw = bytes.toString("latin1");
  for (const forbidden of ["AI-marked", "3/5", "Partly right", "Hint 1", "Nudge", "Feedback"]) {
    expect(raw, `the PDF must not contain "${forbidden}"`).not.toContain(forbidden);
  }
});

test("the topics list leads to a revision session with a fresh variant", async () => {
  await page.goto(`${courseUrl}/topics`);
  await page.getByRole("button", { name: /Integration by parts/ }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Integration by parts" })
    .getByRole("link", { name: "Revise", exact: true })
    .click();
  await expect(page).toHaveURL(/\/revise\?/);

  await page.getByRole("button", { name: "Start revision" }).click();
  await expect(page).toHaveURL(/\/revise\/[^/]+$/);
  // The session builds in the background; it lists a retry and a fresh variant.
  await expect(page.getByText(/fresh variant/i).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: /^(Start|Continue)$/ }).click();
  await expect(page).toHaveURL(/\/questions\/[^/]+\?session=/);
  await expect(page.getByRole("button", { name: "Submit working" })).toBeVisible();
});

test("every main screen fits a phone screen without sideways scrolling", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  const urls: Record<string, string> = {
    courses: "/courses",
    sheets: courseUrl,
    topics: `${courseUrl}/topics`,
    "sheets tab": `${courseUrl}/sheets`,
    mistakes: `${courseUrl}/mistakes`,
    progress: `${courseUrl}/progress`,
    sheet: sheetUrl,
    edit: `${sheetUrl}/edit`,
    history: `${sheetUrl}/history`,
    summary: `${sheetUrl}/summary`,
    solutions: `${sheetUrl}/solutions`,
    question: questionUrl,
    mark: markUrl,
    revise: "/revise",
  };
  const tooWide: string[] = [];
  for (const [name, url] of Object.entries(urls)) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 1) tooWide.push(`${name} (${overflow}px too wide)`);
  }
  expect(tooWide).toEqual([]);
});
