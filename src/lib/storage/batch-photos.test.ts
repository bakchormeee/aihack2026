import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => new Set<string>());
vi.mock("./s3", () => ({
  listObjects: async (prefix: string) => [...stored].filter((key) => key.startsWith(prefix)),
  deleteObject: async (key: string) => void stored.delete(key),
}));

import { batchPhotoPrefix, deleteBatchPhotos } from "./batch-photos";

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
      stored.add(key);

    expect(await deleteBatchPhotos("a", "s1")).toBe(2);
    expect([...stored].sort()).toEqual([
      "u/a/batch/s10/1.jpg",
      "u/a/working/s1/1.jpg",
      "u/b/batch/s1/1.jpg",
    ]);
    expect(await deleteBatchPhotos("a", "s1")).toBe(0);
  });
});
