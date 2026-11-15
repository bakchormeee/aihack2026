import { afterEach, describe, expect, it, vi } from "vitest";

import { speechEnabled, TranscribeError, transcribe } from "./transcribe";

const audio = new Blob(["fake audio"], { type: "audio/webm" });

afterEach(() => vi.unstubAllEnvs());

describe("transcribe", () => {
  it("is disabled without an API key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(speechEnabled()).toBe(false);
    await expect(transcribe(audio, vi.fn())).rejects.toBeInstanceOf(TranscribeError);
  });

  it("sends the clip to ElevenLabs Scribe and returns the trimmed text", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.stubEnv("ELEVENLABS_STT_MODEL", "");
    const fetchMock = vi.fn(async () => Response.json({ text: "  the minus sign is lost  " }));
    expect(await transcribe(audio, fetchMock)).toBe("the minus sign is lost");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("test-key");
    const body = init.body as FormData;
    expect(body.get("model_id")).toBe("scribe_v2");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });

  it("turns an API failure into a friendly error", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("bad", { status: 401 }));
    await expect(transcribe(audio, fetchMock)).rejects.toThrow(/type instead/);
  });
});
