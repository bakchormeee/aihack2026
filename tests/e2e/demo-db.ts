import { loadEnvConfig } from "@next/env";
import type { Browser } from "@playwright/test";
import postgres from "postgres";

import {
  createCourseWithSheet,
  openQuestion,
  signInAsNewUser,
  submitTypedWorking,
} from "./helpers";

// Direct database access for the demo end-to-end test only: to make sure a template
// exists, and to look at copies. It uses the same database as the dev server.

loadEnvConfig(process.cwd());

export const DEMO_TEMPLATE_EMAIL = "demo-template@demo.invalid";

let sql: postgres.Sql | null = null;
export function demoDb(): postgres.Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    sql = postgres(url, { prepare: false, max: 1 });
  }
  return sql;
}

export async function closeDemoDb() {
  await sql?.end();
  sql = null;
}

/**
 * Makes sure there is a demo template. When the real one (built by
 * scripts/build-demo.ts) is missing, a small one is built through the app from the
 * recorded AI answers: one course, one sheet and one marked answer.
 */
export async function ensureDemoTemplate(browser: Browser): Promise<string> {
  const db = demoDb();
  const found = await db<
    { id: string }[]
  >`select id from "user" where demo_role = 'template' limit 1`;
  if (found.length) return found[0].id;

  const context = await browser.newContext();
  const page = await context.newPage();
  const email = await signInAsNewUser(page, "demo-template");
  const { sheetUrl } = await createCourseWithSheet(page, "Demo Calculus");
  await openQuestion(page, sheetUrl, "1");
  await submitTypedWorking(page, "By parts, working here.");
  // The mark is on the question page itself: there is no "See the mark" step.
  await page.getByText("3 / 5", { exact: true }).waitFor();
  await context.close();

  const [user] = await db<{ id: string }[]>`
    update "user" set demo_role = 'template', email = ${DEMO_TEMPLATE_EMAIL}, name = 'Demo student'
    where email = ${email} returning id`;
  return user.id;
}

/** The demo copy that owns a course of this name. */
export async function copyWithCourse(name: string): Promise<string | null> {
  const rows = await demoDb()<{ id: string }[]>`
    select u.id from "user" u join course c on c.user_id = u.id
    where u.demo_role = 'copy' and c.name = ${name}`;
  return rows[0]?.id ?? null;
}

export async function courseNamesOf(userId: string): Promise<string[]> {
  const rows = await demoDb()<
    { name: string }[]
  >`select name from course where user_id = ${userId}`;
  return rows.map((r) => r.name);
}

export async function demoUserExists(userId: string): Promise<boolean> {
  const rows = await demoDb()`select 1 from "user" where id = ${userId}`;
  return rows.length > 0;
}

export async function setDemoAiCalls(userId: string, used: number) {
  await demoDb()`update "user" set demo_ai_calls = ${used} where id = ${userId} and demo_role = 'copy'`;
}
