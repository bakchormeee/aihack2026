import { describe, expect, it } from "vitest";

import { locateQuotes, splitByRanges } from "./locate-quotes";

const text = "We have $x^2 + 1 = 5$.\nSo   $x = 3$ and the answer is $3$.";

describe("locateQuotes", () => {
  it("finds a quote that appears exactly", () => {
    const [range] = locateQuotes(text, ["$x^2 + 1 = 5$"]);

    expect(text.slice(range!.start, range!.end)).toBe("$x^2 + 1 = 5$");
  });

  it("finds a quote that differs only in spacing and line breaks", () => {
    const [range] = locateQuotes(text, ["So $x = 3$"]);

    expect(text.slice(range!.start, range!.end)).toBe("So   $x = 3$");
  });

  it("finds a quote written without its dollar signs", () => {
    const [range] = locateQuotes(text, ["x = 3"]);

    expect(text.slice(range!.start, range!.end)).toBe("$x = 3$"); // the whole maths is boxed, not half of it
  });

  it("returns null for a quote that is not in the working", () => {
    expect(locateQuotes(text, ["$y = 7$"])).toEqual([null]);
    expect(locateQuotes(text, ["   "])).toEqual([null]);
  });

  it("does not box the inside of a piece of maths when the quote is only part of it", () => {
    expect(locateQuotes(text, ["x^2"])).toEqual([null]);
  });

  it("gives no box to a quote that starts or ends part-way through a piece of maths", () => {
    expect(locateQuotes(text, ["^2 + 1"])).toEqual([null]); // starts inside
    expect(locateQuotes(text, ["x^2 +"])).toEqual([null]); // starts at the maths, ends inside
    expect(locateQuotes(text, ["have $x^2"])).toEqual([null]); // ends inside
  });

  it("gives an overlapping quote no box, so only the first one is drawn", () => {
    const ranges = locateQuotes(text, ["$x = 3$ and", "and the answer"]);

    expect(ranges[0]).not.toBeNull();
    expect(ranges[1]).toBeNull();
  });

  it("uses a later copy of the same words for a second mistake", () => {
    const twice = "$a$ then $a$";
    const [first, second] = locateQuotes(twice, ["$a$", "$a$"]);

    expect(first!.start).toBe(0);
    expect(second!.start).toBe(9);
  });

  it("treats regex symbols in a quote as plain characters", () => {
    expect(locateQuotes("cost (a+b)*c?", ["(a+b)*c?"])).toEqual([{ start: 5, end: 13 }]);
  });
});

describe("splitByRanges", () => {
  it("cuts the text into plain and boxed pieces in order, numbering boxes from 0", () => {
    const pieces = splitByRanges("abcdef", [null, { start: 3, end: 5 }, { start: 0, end: 1 }]);

    expect(pieces).toEqual([
      { text: "a", box: 2 },
      { text: "bc", box: null },
      { text: "de", box: 1 },
      { text: "f", box: null },
    ]);
  });

  it("has no plain piece after a box that ends the text", () => {
    expect(splitByRanges("abc", [{ start: 1, end: 3 }])).toEqual([
      { text: "a", box: null },
      { text: "bc", box: 0 },
    ]);
  });

  it("returns the whole text as one plain piece when nothing is boxed", () => {
    expect(splitByRanges("abc", [null])).toEqual([{ text: "abc", box: null }]);
  });
});
