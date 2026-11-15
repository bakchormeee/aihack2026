import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { DEMO_TEMPLATE_EMAIL } from "@/db/queries/demo";
import { accounts, users } from "@/db/schema";

import { authorizeDemo, demoAccess, refuseDemoLink } from "./demo-sign-in";

vi.setConfig({ testTimeout: 60_000 });

const NOW = new Date("2026-11-15T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const noFiles = { deleteObject: async () => {} };

describe("demoAccess", () => {
  it("is real for a user without a demo role", () => {
    expect(demoAccess({ demoRole: null, demoExpiresAt: null }, NOW)).toBe("real");
  });

  it("is live for a copy before it expires, and ended from its expiry on", () => {
    const expiresAt = new Date(NOW.getTime() + HOUR);
    expect(demoAccess({ demoRole: "copy", demoExpiresAt: expiresAt }, NOW)).toBe("live");
    expect(demoAccess({ demoRole: "copy", demoExpiresAt: expiresAt }, expiresAt)).toBe("ended");
  });

  it("is ended when the user no longer exists (an erased copy) or is the template", () => {
    expect(demoAccess(null, NOW)).toBe("ended");
    expect(demoAccess({ demoRole: "template", demoExpiresAt: null }, NOW)).toBe("ended");
  });
});

describe("authorizeDemo", () => {
  it("returns nothing while there is no template", async () => {
    expect(await authorizeDemo(NOW, noFiles)).toBeNull();
  });

  it("creates a fresh copy each time, never the template", async () => {
    const [template] = await db
      .insert(users)
      .values({ email: DEMO_TEMPLATE_EMAIL, name: "Demo student", demoRole: "template" })
      .returning();

    const a = await authorizeDemo(NOW, noFiles);
    const b = await authorizeDemo(NOW, noFiles);
    expect(a).toMatchObject({ name: "Demo student", email: null });
    expect(a!.id).not.toBe(template.id);
    expect(b!.id).not.toBe(a!.id);
    const [row] = await db.select().from(users).where(eq(users.id, a!.id));
    expect(row.demoRole).toBe("copy");
  });
});

describe("refuseDemoLink", () => {
  it("removes a Google account linked to a demo user, and leaves a real user's alone", async () => {
    const [copy] = await db
      .insert(users)
      .values({ demoRole: "copy", demoExpiresAt: new Date(NOW.getTime() + HOUR) })
      .returning();
    const [real] = await db.insert(users).values({ email: "linker@test.local" }).returning();
    await db.insert(accounts).values([
      { userId: copy.id, type: "oidc", provider: "google", providerAccountId: "g-copy" },
      { userId: real.id, type: "oidc", provider: "google", providerAccountId: "g-real" },
    ]);

    await refuseDemoLink(copy.id, { provider: "google", providerAccountId: "g-copy" });
    await refuseDemoLink(real.id, { provider: "google", providerAccountId: "g-real" });

    const left = await db.select().from(accounts);
    expect(left.map((a) => a.providerAccountId)).toEqual(["g-real"]);
  });
});
