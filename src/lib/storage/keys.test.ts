import { describe, expect, it } from "vitest";

import { assertOwnedKey, buildKey, extensionForMime } from "./keys";

describe("extensionForMime", () => {
  it.each([
    ["application/pdf", "pdf"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("maps %s to %s", (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });

  it("returns null for a type that is not accepted", () => {
    expect(extensionForMime("image/heic")).toBeNull();
    expect(extensionForMime("text/html")).toBeNull();
  });
});

describe("buildKey", () => {
  it("puts the user first, then the purpose and parent, and ends with the extension", () => {
    const key = buildKey({
      userId: "u1",
      purpose: "working",
      parentId: "att9",
      mime: "image/jpeg",
    });

    expect(key).toMatch(/^u\/u1\/working\/att9\/[0-9a-f-]{36}\.jpg$/);
  });

  it("gives a different key every time", () => {
    const input = {
      userId: "u1",
      purpose: "sheet",
      parentId: "c1",
      mime: "application/pdf",
    } as const;

    expect(buildKey(input)).not.toBe(buildKey(input));
  });

  it("rejects an ids that could change the path", () => {
    const base = { purpose: "sheet", mime: "application/pdf" } as const;

    expect(() => buildKey({ ...base, userId: "u1", parentId: "../u2" })).toThrow();
    expect(() => buildKey({ ...base, userId: "u/2", parentId: "c1" })).toThrow();
  });

  it("rejects a mime type that is not accepted", () => {
    expect(() =>
      buildKey({ userId: "u1", purpose: "sheet", parentId: "c1", mime: "image/heic" }),
    ).toThrow("not accepted");
  });
});

describe("assertOwnedKey", () => {
  it("accepts a key under the user's own prefix", () => {
    expect(() => assertOwnedKey("u1", "u/u1/working/a/x.jpg")).not.toThrow();
  });

  it("refuses another user's key", () => {
    expect(() => assertOwnedKey("u1", "u/u2/working/a/x.jpg")).toThrow("not owned");
  });

  it("refuses a user id that is only a prefix of another id", () => {
    expect(() => assertOwnedKey("u1", "u/u10/working/a/x.jpg")).toThrow("not owned");
  });

  it("refuses a key that climbs out with ..", () => {
    expect(() => assertOwnedKey("u1", "u/u1/../u2/x.jpg")).toThrow("not owned");
  });

  it("refuses an empty or non-string key", () => {
    expect(() => assertOwnedKey("u1", "")).toThrow("not owned");
    expect(() => assertOwnedKey("u1", undefined as unknown as string)).toThrow("not owned");
  });
});
