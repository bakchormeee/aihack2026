import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { courses, sheets, users } from "@/db/schema";

const signedIn = vi.hoisted(() => ({ id: "" as string | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => (signedIn.id ? { id: signedIn.id, email: null, name: null } : null),
}));
vi.mock("@/lib/storage/s3", () => ({
  presignUpload: async (key: string) => `https://upload.test/${key}`,
}));

import { POST } from "./route";

async function userWithSheet(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  return { user, course, sheet };
}

function request(body: unknown) {
  return new Request("http://localhost/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const photo = { mime: "image/jpeg", size: 1000 };

describe("POST /api/uploads/presign with purpose batch", () => {
  it("gives a key under the user's batch folder for their own sheet", async () => {
    const { user, sheet } = await userWithSheet("batch-own@test.local");
    signedIn.id = user.id;

    const res = await POST(request({ purpose: "batch", parentId: sheet.id, ...photo }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toMatch(new RegExp(`^u/${user.id}/batch/${sheet.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(body.url).toBe(`https://upload.test/${body.key}`);
  });

  it("refuses another user's sheet with 404", async () => {
    const { sheet } = await userWithSheet("batch-owner@test.local");
    const { user: other } = await userWithSheet("batch-other@test.local");
    signedIn.id = other.id;

    const res = await POST(request({ purpose: "batch", parentId: sheet.id, ...photo }));

    expect(res.status).toBe(404);
  });

  it("refuses a PDF, since batch working is photos only", async () => {
    const { user, sheet } = await userWithSheet("batch-pdf@test.local");
    signedIn.id = user.id;

    const res = await POST(
      request({ purpose: "batch", parentId: sheet.id, mime: "application/pdf", size: 1000 }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Use a JPEG, PNG or WebP photo." });
  });
});

describe("POST /api/uploads/presign", () => {
  it("asks the visitor to sign in first", async () => {
    signedIn.id = null;
    const res = await POST(request({ purpose: "batch", parentId: "x", ...photo }));
    expect(res.status).toBe(401);
  });

  it("refuses an unknown purpose and a file that is too large", async () => {
    const { user, sheet } = await userWithSheet("presign-bad@test.local");
    signedIn.id = user.id;

    expect((await POST(request({ purpose: "other", parentId: sheet.id, ...photo }))).status).toBe(
      400,
    );
    const big = await POST(
      request({ purpose: "batch", parentId: sheet.id, mime: "image/jpeg", size: 50 * 1024 * 1024 }),
    );
    expect(big.status).toBe(400);
  });

  it("still gives official-solutions keys for the user's own sheet", async () => {
    const { user, sheet } = await userWithSheet("presign-official@test.local");
    signedIn.id = user.id;

    const res = await POST(
      request({
        purpose: "official_solutions",
        parentId: sheet.id,
        mime: "application/pdf",
        size: 10,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).key).toContain(`/official_solutions/${sheet.id}/`);
  });
});
