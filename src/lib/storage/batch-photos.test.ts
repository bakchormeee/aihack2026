import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => new Map<string, Date | null>());
vi.mock("./s3", () => ({
  listObjects: async (prefix: string) =>
    [...stored]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, lastModified]) => ({ key, lastModified })),
  deleteObject: async (key: string) => void stored.delete(key),
}));

import { batchPhotoPrefix, deleteBatchPhotos, deleteLeftoverBatchPhotos } from "./batch-photos";

beforeEach(() => stored.clear());

describe("batchPhotoPrefix", () => {
  it("is the sheet's folder under the user's batch folder", () => {
    expect(batchPhotoPrefix("user-1", "sheet_2")).toBe("u/user-1/batch/sheet_2/");
  });

  it("refuses ids that could reach another folder", () => {
    expect(() => batchPhotoPrefix("user-1", "")).toThrow();
    expect(() => batchPhotoPrefix("user-1", "../x")).toThrow();
    expect(() => batchPhotoPrefix("a/b", "s")).toThrow();
  });
});

describe("deleteBatchPhotos", () => {
  it("deletes the sheet's batch photos and nothing else", async () => {
    for (const key of [
      "u/a/batch/s1/1.jpg",
      "u/a/batch/s1/2.jpg",
      "u/a/batch/s10/1.jpg",
      "u/a/working/s1/1.jpg",
      "u/b/batch/s1/1.jpg",
    ])
      stored.set(key, null);

    expect(await deleteBatchPhotos("a", "s1")).toBe(2);
    expect([...stored.keys()].sort()).toEqual([
      "u/a/batch/s10/1.jpg",
      "u/a/working/s1/1.jpg",
      "u/b/batch/s1/1.jpg",
    ]);
    expect(await deleteBatchPhotos("a", "s1")).toBe(0);
  });

  it("with olderThan, keeps photos uploaded since then (a review open in another tab)", async () => {
    const cutoff = new Date("2026-11-15T10:00:00Z");
    stored.set("u/a/batch/s1/old.jpg", new Date("2026-11-15T08:59:00Z"));
    stored.set("u/a/batch/s1/new.jpg", new Date("2026-11-15T10:30:00Z"));
    stored.set("u/a/batch/s1/unknown.jpg", null);

    expect(await deleteBatchPhotos("a", "s1", { olderThan: cutoff })).toBe(2);
    expect([...stored.keys()]).toEqual(["u/a/batch/s1/new.jpg"]);
  });
});

describe("deleteLeftoverBatchPhotos", () => {
  it("deletes photos uploaded more than an hour ago only", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    stored.set("u/a/batch/s1/old.jpg", new Date("2026-11-15T10:59:59Z"));
    stored.set("u/a/batch/s1/recent.jpg", new Date("2026-11-15T11:30:00Z"));

    expect(await deleteLeftoverBatchPhotos("a", "s1", now)).toBe(1);
    expect([...stored.keys()]).toEqual(["u/a/batch/s1/recent.jpg"]);
  });
});
