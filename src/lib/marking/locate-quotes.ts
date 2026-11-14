// Finds where the marker's quotes sit in the student's typed working, so the mark
// screen can draw a box round each one. Pure, so it is tested without a browser.

export type Range = { start: number; end: number };
export type Piece = { text: string; box: number | null };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A pattern for the quote that ignores differences in spaces and line breaks. */
function patternFor(quote: string): RegExp | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return new RegExp(words.map(escape).join("\\s+"), "g");
}

const dollarsBefore = (text: string, index: number) => text.slice(0, index).split("$").length - 1;

/**
 * One range per quote, in order, or null when the quote is not found, would
 * start or end inside a piece of maths, or overlaps an earlier box.
 * The marker may quote maths with or without its dollar signs.
 */
export function locateQuotes(text: string, quotes: string[]): (Range | null)[] {
  const taken: Range[] = [];
  return quotes.map((quote) => {
    for (const candidate of [quote, quote.replaceAll("$", "")]) {
      const pattern = patternFor(candidate);
      if (!pattern) continue;
      for (const match of text.matchAll(pattern)) {
        let start = match.index;
        let end = start + match[0].length;
        // A quote of the inside of maths boxes the whole of it: take in the dollar signs.
        if (dollarsBefore(text, start) % 2 === 1) {
          if (text[start - 1] !== "$") continue;
          start -= 1;
          if (text[end] !== "$") continue;
          end += 1;
        }
        if (dollarsBefore(text, end) % 2 === 1) continue;
        if (taken.some((range) => start < range.end && end > range.start)) continue;
        const range = { start, end };
        taken.push(range);
        return range;
      }
    }
    return null;
  });
}

/** Cuts the text into plain and boxed pieces; `box` is the index of the quote. */
export function splitByRanges(text: string, ranges: (Range | null)[]): Piece[] {
  const boxes = ranges
    .map((range, box) => ({ range, box }))
    .filter((entry): entry is { range: Range; box: number } => entry.range !== null)
    .sort((a, b) => a.range.start - b.range.start);

  const pieces: Piece[] = [];
  let at = 0;
  for (const { range, box } of boxes) {
    if (range.start > at) pieces.push({ text: text.slice(at, range.start), box: null });
    pieces.push({ text: text.slice(range.start, range.end), box });
    at = range.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), box: null });
  return pieces;
}
