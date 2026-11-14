import { describe, expect, it } from "vitest";

import { mapLimit } from "./concurrency";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("mapLimit", () => {
  it("returns results in the order of the input", async () => {
    const result = await mapLimit([3, 1, 2], 2, async (n) => {
      for (let i = 0; i < n; i++) await tick();
      return n * 10;
    });

    expect(result).toEqual([30, 10, 20]);
  });

  it("never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;

    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
    });

    expect(peak).toBe(3);
  });

  it("passes the index to the function", async () => {
    const result = await mapLimit(["a", "b"], 5, async (item, index) => `${index}:${item}`);

    expect(result).toEqual(["0:a", "1:b"]);
  });

  it("returns an empty array for no items", async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([]);
  });

  it("rejects when the function throws and starts no further items", async () => {
    const started: number[] = [];

    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(started).toEqual([1, 2]);
  });

  it("rejects a limit below 1", async () => {
    await expect(mapLimit([1], 0, async (n) => n)).rejects.toThrow("limit");
  });
});
