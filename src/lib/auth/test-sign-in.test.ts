import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { users } from "@/db/schema";

import { findOrCreateTestUser, isTestEmail, isTestSignInEnabled } from "./test-sign-in";

describe("isTestSignInEnabled", () => {
  it("is enabled in development when the flag is 1", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "development", ENABLE_TEST_SIGN_IN: "1" })).toBe(true);
  });

  it("is enabled under test when the flag is 1", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "test", ENABLE_TEST_SIGN_IN: "1" })).toBe(true);
  });

  it("is disabled in production even when the flag is 1", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "production", ENABLE_TEST_SIGN_IN: "1" })).toBe(false);
  });

  it("is disabled in development when the flag is not set", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("is disabled in production when the flag is not set", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("is disabled when the flag is anything other than 1", () => {
    expect(isTestSignInEnabled({ NODE_ENV: "development", ENABLE_TEST_SIGN_IN: "true" })).toBe(
      false,
    );
  });
});

describe("isTestEmail", () => {
  it("accepts a name at test.local", () => {
    expect(isTestEmail("track-h@test.local")).toBe(true);
  });

  it("rejects a real domain", () => {
    expect(isTestEmail("someone@gmail.com")).toBe(false);
  });

  it("rejects a lookalike domain", () => {
    expect(isTestEmail("a@test.local.evil.com")).toBe(false);
    expect(isTestEmail("a@evil.test.local")).toBe(false);
  });

  it("rejects an empty name and non-strings", () => {
    expect(isTestEmail("@test.local")).toBe(false);
    expect(isTestEmail(undefined)).toBe(false);
    expect(isTestEmail(42)).toBe(false);
  });
});

describe("findOrCreateTestUser", () => {
  it("creates a user the first time", async () => {
    const user = await findOrCreateTestUser("first@test.local");

    expect(user.email).toBe("first@test.local");
    expect(user.id).toBeTruthy();
  });

  it("returns the same user the second time without creating another", async () => {
    const a = await findOrCreateTestUser("again@test.local");
    const b = await findOrCreateTestUser("again@test.local");

    expect(b.id).toBe(a.id);
    const rows = await db.select().from(users).where(eq(users.email, "again@test.local"));
    expect(rows).toHaveLength(1);
  });

  it("refuses an email that is not a test address", async () => {
    await expect(findOrCreateTestUser("real.person@gmail.com")).rejects.toThrow("test address");
    const rows = await db.select().from(users).where(eq(users.email, "real.person@gmail.com"));
    expect(rows).toHaveLength(0);
  });
});
