import { afterEach, describe, expect, it, vi } from "vitest";

import { AiOutputError, setAiClient } from "./client";
import { matchWorking, matchWorkingSchema } from "./match-working";
import { fakeAi, fixture, sentSystem, sentText } from "./test-helpers";

const photo = { mime: "image/jpeg", data: Buffer.from("photo") };
const questions = [
  { label: "1", body: String.raw`Differentiate $f(x) = x^2 \sin x$.` },
  { label: "2(a)", body: String.raw`Evaluate $\int_0^{\pi} x \cos x \, dx$.` },
];

afterEach(() => {
  setAiClient(null);
  vi.unstubAllEnvs();
});

describe("matchWorking schema", () => {
  it("accepts the valid fixture, with an unmatched region", () => {
    const parsed = matchWorkingSchema.parse(fixture("matchWorking"));
    expect(parsed.regions.length).toBeGreaterThan(0);
    expect(parsed.regions.some((r) => r.questionLabel === null)).toBe(true);
  });

  it("rejects the invalid fixture", () => {
    expect(matchWorkingSchema.safeParse(fixture("matchWorking.invalid")).success).toBe(false);
  });

  it("rejects a negative photo number and an empty label", () => {
    const region = { photo: 0, box: { x: 0, y: 0, w: 1, h: 1 }, questionLabel: "1" };
    const ok = (r: object) =>
      matchWorkingSchema.safeParse({ regions: [{ ...region, ...r }] }).success;
    expect(ok({})).toBe(true);
    expect(ok({ photo: -1 })).toBe(false);
    expect(ok({ questionLabel: " " })).toBe(false);
  });
});

describe("matchWorking", () => {
  it("sends the photos and every question's label and body, and returns the regions", async () => {
    const regions = [
      { photo: 1, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, questionLabel: "2(a)" },
      { photo: 0, box: { x: 0, y: 0, w: 1, h: 0.5 }, questionLabel: null },
    ];
    const create = fakeAi({ regions });

    const result = await matchWorking({ photos: [photo, photo], questions });

    expect(result).toEqual(regions);
    const sent = create.mock.calls[0][0].messages[0].content as { type: string }[];
    expect(sent.filter((block) => block.type === "image")).toHaveLength(2);
    expect(sentText(create)).toContain("2 photos are attached");
    expect(sentText(create)).toContain("Question label: 2(a)");
    expect(sentText(create)).toContain(String.raw`\int_0^{\pi}`);
    expect(sentSystem(create)).toMatch(/Never guess/);
    expect(sentSystem(create)).toMatch(/numbers the student wrote/);
  });

  it("makes no request without photos or without questions", async () => {
    const create = fakeAi();
    expect(await matchWorking({ photos: [], questions })).toEqual([]);
    expect(await matchWorking({ photos: [photo], questions: [] })).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("reads the fixture in fixture mode", async () => {
    vi.stubEnv("AI_FIXTURES", "1");
    const result = await matchWorking({ photos: [photo, photo], questions });
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({
      photo: 0,
      box: { x: 0.05, y: 0.04, w: 0.9, h: 0.22 },
      questionLabel: "1",
    });
  });

  it("throws AiOutputError after two invalid replies", async () => {
    fakeAi(fixture("matchWorking.invalid"), fixture("matchWorking.invalid"));
    await expect(matchWorking({ photos: [photo], questions })).rejects.toBeInstanceOf(
      AiOutputError,
    );
  });
});
