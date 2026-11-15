"use client";

import { useEffect } from "react";

import { playSfxOnce, type Sfx } from "@/lib/sfx";

/** Renders nothing; plays a sound once when a result first appears on screen. */
export function PlaySound({ sound, once }: { sound: Sfx; once: string }) {
  useEffect(() => {
    playSfxOnce(sound, once);
  }, [sound, once]);
  return null;
}
