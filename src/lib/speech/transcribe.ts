/** Speech to text through ElevenLabs Scribe. Server only: it uses the secret API key. */

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";

/** Longest recording accepted, in bytes (about 10 minutes of compressed speech). */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export class TranscribeError extends Error {}

export function speechEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Turns one recorded clip into text. Throws TranscribeError when ElevenLabs fails. */
export async function transcribe(audio: Blob, fetchImpl: typeof fetch = fetch): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TranscribeError("Speech input is not set up.");

  const form = new FormData();
  form.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v2");
  form.append("file", audio, "answer.webm");
  form.append("tag_audio_events", "false");
  if (process.env.ELEVENLABS_STT_LANGUAGE)
    form.append("language_code", process.env.ELEVENLABS_STT_LANGUAGE);

  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`ElevenLabs speech-to-text failed: ${response.status} ${detail.slice(0, 300)}`);
    throw new TranscribeError("Could not understand the recording. Try again or type instead.");
  }
  const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
  if (!data || typeof data.text !== "string")
    throw new TranscribeError("Could not understand the recording. Try again or type instead.");
  return data.text.trim();
}
