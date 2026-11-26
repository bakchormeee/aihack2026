import { describe, expect, it } from "vitest";

import type { Mistake } from "@/lib/domain";

import { numberMistakes } from "./numbering";

const typed = (quote: string): Mistake => ({
  type: "method",
  quote,
  hint: "h",
  location: { kind: "text" },
});
const photo = (fileIndex: number): Mistake => ({
  type: "method",
  quote: "q",
  hint: "h",
  location: { kind: "image", fileIndex, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
});
const pdf = (page: number): Mistake => ({
  type: "method",
  quote: "q",
  hint: "h",
  location: { kind: "pdf", fileIndex: 0, page },
});

const working = { text: "Start $x = 3$ and so on", fileMimes: ["image/jpeg", "image/png"] };

describe("numberMistakes", () => {
  it("numbers the mistakes once, in order, across typed text and photos", () => {
    const numbers = numberMistakes([typed("$x = 3$"), photo(0), photo(1), typed("Start")], working);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it("gives no number to a quote that is not in the typed text", () => {
    const numbers = numberMistakes([typed("not there"), typed("$x = 3$"), photo(0)], working);
    expect(numbers).toEqual([null, 1, 2]);
  });

  it("gives no number to a typed mistake when nothing was typed", () => {
    expect(numberMistakes([typed("x")], { text: null, fileMimes: [] })).toEqual([null]);
    expect(numberMistakes([typed("x")], { text: "   ", fileMimes: [] })).toEqual([null]);
  });

  it("gives no number to a photo mistake whose file is missing or is not a photo", () => {
    const numbers = numberMistakes([photo(5), photo(0), pdf(1)], {
      text: null,
      fileMimes: ["application/pdf"],
    });
    expect(numbers).toEqual([null, null, 1]);
  });

  it("numbers PDF notes, which carry their page instead of a box", () => {
    const numbers = numberMistakes([pdf(2), typed("Start"), pdf(3)], {
      text: "Start here",
      fileMimes: ["application/pdf"],
    });
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("has nothing to number without mistakes", () => {
    expect(numberMistakes([], working)).toEqual([]);
  });
});
