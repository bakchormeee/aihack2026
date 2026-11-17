"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { isMuted, setMuted, subscribeMuted } from "@/lib/sfx";

/** Header button that turns the interface sounds on and off. */
export function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-pressed={!muted}
      aria-label={muted ? "Turn sounds on" : "Turn sounds off"}
      title={muted ? "Turn sounds on" : "Turn sounds off"}
      onClick={() => setMuted(!muted)}
    >
      {muted ? <VolumeX /> : <Volume2 />}
    </Button>
  );
}
