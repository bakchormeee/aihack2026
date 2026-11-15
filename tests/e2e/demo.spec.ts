import { expect, test, type Page } from "@playwright/test";

import {
  closeDemoDb,
  copyWithCourse,
  courseNamesOf,
  demoUserExists,
  ensureDemoTemplate,
  setDemoAiCalls,
} from "./demo-db";
import { MINIMAL_PDF } from "./helpers";

// The demo link (SPEC-demo.md): no sign-in, a private copy per visitor, Start again,
// signing out ends it, and it fits a phone.

test.setTimeout(240_000);

const BANNER = "Demo: your changes are private and are deleted after 24 hours.";

let templateId = "";
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  templateId = await ensureDemoTemplate(browser);
});
test.afterAll(closeDemoDb);

async function openDemo(page: Page) {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/courses$/, { timeout: 60_000 });
  await expect(page.getByText(BANNER)).toBeVisible();
}

async function addCourse(page: Page, name: string) {
  await page.getByLabel(/New course/).fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/sheets$/);
  await page.goto("/courses");
}

test("the demo link opens a private copy without signing in", async ({ browser }, info) => {
  const templateCourses = await courseNamesOf(templateId);
  expect(templateCourses.length).toBeGreaterThan(0);

  // A first visitor lands in the courses of the demo student.
  const judge = await browser.newContext();
  const page = await judge.newPage();
  await openDemo(page);
  for (const name of templateCourses) {
    await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath("demo-desktop.png") });

  // Their change stays for the rest of their visit.
  const mine = `Judge course ${Date.now()}`;
  await addCourse(page, mine);
  await openDemo(page);
  await expect(page.getByText(mine)).toBeVisible();
  const copyId = await copyWithCourse(mine);
  expect(copyId).not.toBeNull();

  // A second visitor gets a separate copy, and the template is unchanged.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await openDemo(otherPage);
  await expect(otherPage.getByText(templateCourses[0]).first()).toBeVisible();
  await expect(otherPage.getByText(mine)).toHaveCount(0);
  expect(await courseNamesOf(templateId)).toEqual(templateCourses);
  await other.close();

  // At 30 AI calls, uploading a sheet is refused before any AI work starts.
  await setDemoAiCalls(copyId!, 30);
  await page.getByText(mine).click();
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await page.goto(`${page.url()}/sheets`);
  // Wait for the page to be interactive before choosing the file.
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Problem Sheet 1.pdf",
    mimeType: "application/pdf",
    buffer: MINIMAL_PDF,
  });
  await expect(
    page.getByText("The demo limit for AI is reached. Start again for a fresh copy"),
  ).toBeVisible();
  await page.goto("/courses");

  // It fits a phone screen, banner included.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("demo-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });

  // Start again gives a fresh copy; the old one is erased.
  await page.getByRole("button", { name: "Start again" }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByText(BANNER)).toBeVisible();
  await expect(page.getByText(mine)).toHaveCount(0);
  await expect.poll(() => demoUserExists(copyId!), { timeout: 30_000 }).toBe(false);

  // Signing out ends the demo.
  const second = `Second course ${Date.now()}`;
  await addCourse(page, second);
  const secondId = await copyWithCourse(second);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect.poll(() => demoUserExists(secondId!), { timeout: 30_000 }).toBe(false);
  await judge.close();
});

test("the landing and sign-in pages lead to the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Try the demo" })).toHaveAttribute("href", "/demo");
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/courses$/, { timeout: 60_000 });
  await expect(page.getByText(BANNER)).toBeVisible();
});
