/**
 * Short interface sounds, made once with ElevenLabs sound generation and
 * served from /public/sfx, so playing them needs no API key. Browser only.
 */

export type Sfx =
  "success" | "partial" | "stuck" | "fanfare" | "hint" | "tick" | "mic-on" | "mic-off";

const VOLUME: Partial<Record<Sfx, number>> = { tick: 0.35, "mic-on": 0.4, "mic-off": 0.4 };
const MUTE_KEY = "sfx-muted";
const listeners = new Set<() => void>();

export function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(muted: boolean) {
  window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  listeners.forEach((listener) => listener());
}

export function subscribeMuted(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Plays a sound unless the student muted them. Never throws: blocked autoplay is ignored. */
export function playSfx(name: Sfx) {
  if (isMuted()) return;
  try {
    const audio = new Audio(`/sfx/${name}.mp3`);
    audio.volume = VOLUME[name] ?? 0.6;
    void audio.play().catch(() => {});
  } catch {
    // No audio support: stay silent.
  }
}

/** Plays a sound once per key in this browser tab, so refreshes don't replay it. */
export function playSfxOnce(name: Sfx, key: string) {
  const storageKey = `sfx-played:${key}`;
  try {
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");
  } catch {
    // Storage blocked: play anyway.
  }
  playSfx(name);
}
