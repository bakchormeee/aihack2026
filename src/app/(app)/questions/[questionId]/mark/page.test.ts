import { describe, expect, it } from "vitest";

import MarkPage from "./page";

/** The address a redirect() went to: Next throws an error whose digest ends with it. */
async function redirectedTo(query: Record<string, string | string[] | undefined>) {
  try {
    await MarkPage({
      params: Promise.resolve({ questionId: "q1" }),
      searchParams: Promise.resolve(query),
    } as never);
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  throw new Error("did not redirect");
}

describe("the old mark address", () => {
  it("redirects to the question page with the attempt kept", async () => {
    expect(await redirectedTo({ attempt: "a1" })).toBe("/questions/q1?attempt=a1");
  });

  it("keeps the revision session as well", async () => {
    expect(await redirectedTo({ attempt: "a1", session: "s1" })).toBe(
      "/questions/q1?attempt=a1&session=s1",
    );
    expect(await redirectedTo({ session: "s1" })).toBe("/questions/q1?session=s1");
  });

  it("redirects a bare address, and ignores empty or repeated values", async () => {
    expect(await redirectedTo({})).toBe("/questions/q1");
    expect(await redirectedTo({ attempt: "", session: ["a", "b"] })).toBe("/questions/q1");
  });
});
