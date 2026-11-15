"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { playSfx } from "@/lib/sfx";

type State = "idle" | "recording" | "transcribing";

/**
 * Records the student speaking and sends it to ElevenLabs (through our server) for a transcript.
 * Press once to start, again to stop; the text is handed to onText.
 */
export function DictateButton({
  onText,
  label = "Speak your answer",
}: {
  onText: (text: string) => void;
  label?: string;
}) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const lifetime = useRef<AbortController | null>(null);

  // Leaving the page cancels recording and uploads; only an explicit stop sends audio.
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      const current = recorder.current;
      if (current) {
        current.onstop = null;
        current.ondataavailable = null;
        if (current.state !== "inactive") current.stop();
      }
      current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Please type instead.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (!signal.aborted)
        setError("Microphone access was blocked. Allow it in the browser, or type instead.");
      return;
    }
    if (signal.aborted) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const media = new MediaRecorder(stream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (!signal.aborted)
        void send(new Blob(chunks.current, { type: media.mimeType || "audio/webm" }), signal);
    };
    recorder.current = media;
    media.start();
    playSfx("mic-on");
    setState("recording");
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    playSfx("mic-off");
    setState("transcribing");
  }

  async function send(audio: Blob, signal: AbortSignal) {
    if (audio.size === 0) {
      setState("idle");
      return;
    }
    try {
      const body = new FormData();
      body.append("audio", audio, "answer.webm");
      const response = await fetch("/api/speech/transcribe", { method: "POST", body, signal });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (signal.aborted) return;
      if (!response.ok) setError(data.error ?? "Could not transcribe that. Please try again.");
      else if (data.text) onText(data.text);
      else setError("No speech was heard. Please try again.");
    } catch {
      if (!signal.aborted) setError("Could not reach the server. Please try again.");
    } finally {
      if (!signal.aborted) setState("idle");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={state === "recording" ? "destructive" : "outline"}
        disabled={state === "transcribing"}
        aria-pressed={state === "recording"}
        onClick={state === "recording" ? stop : start}
      >
        {state === "recording" ? (
          <Square data-icon="inline-start" />
        ) : state === "transcribing" ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Mic data-icon="inline-start" />
        )}
        {state === "recording"
          ? "Stop recording"
          : state === "transcribing"
            ? "Transcribing…"
            : label}
      </Button>
      {state === "recording" ? (
        <span className="text-pen flex items-center gap-1.5 text-xs" role="status">
          <span className="bg-pen size-2 animate-pulse rounded-full" aria-hidden="true" />
          Listening…
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      ) : null}
    </div>
  );
}
