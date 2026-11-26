// One numbering for the mistakes of an attempt, shared by the typed working, the photos and the
// list of notes (SPEC-study-views.md, mark-in-place). A mistake with a place in the working gets
// the next number; one with no place (no box, no matching quote) gets none and is listed bare.

import type { Mistake } from "@/lib/domain";

import { locateQuotes } from "./locate-quotes";

/** What the student submitted, as far as numbering needs it. */
export type NumberedWorking = {
  text: string | null;
  /** The mime type of each file, in submission order (a mistake's `fileIndex` points into it). */
  fileMimes: string[];
};

/**
 * One entry per mistake, in order: its number (1, 2, 3…), or null when it has no place.
 * - typed: numbered when its quote is found in the typed text;
 * - photo: numbered when `fileIndex` is a photo (its box is drawn on it);
 * - PDF: always numbered, and the note says its page (no box is drawn on a PDF page).
 */
export function numberMistakes(mistakes: Mistake[], working: NumberedWorking): (number | null)[] {
  const text = working.text?.trim() ? working.text : "";
  const found = locateQuotes(
    text,
    mistakes.map((mistake) => (mistake.location.kind === "text" ? mistake.quote : "")),
  );
  let next = 1;
  return mistakes.map((mistake, index) => {
    const { location } = mistake;
    const placed =
      location.kind === "text"
        ? found[index] !== null
        : location.kind === "image"
          ? (working.fileMimes[location.fileIndex]?.startsWith("image/") ?? false)
          : true;
    return placed ? next++ : null;
  });
}
