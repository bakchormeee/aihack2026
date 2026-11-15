import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { MAX_AUDIO_BYTES, TranscribeError, transcribe } from "@/lib/speech/transcribe";

export const maxDuration = 60;

/** Takes one recorded clip (form field "audio") and returns { text }. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0)
    return NextResponse.json({ error: "No recording received." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES)
    return NextResponse.json({ error: "That recording is too long." }, { status: 413 });
  if (audio.type && !audio.type.startsWith("audio/") && !audio.type.startsWith("video/webm"))
    return NextResponse.json({ error: "That is not an audio recording." }, { status: 400 });

  try {
    return NextResponse.json({ text: await transcribe(audio) });
  } catch (error) {
    if (error instanceof TranscribeError)
      return NextResponse.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
