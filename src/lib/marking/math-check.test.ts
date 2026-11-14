import { describe, expect, it } from "vitest";

import { mathIsDelimited } from "./math-check";

describe("mathIsDelimited", () => {
  it.each([
    ["Check the recurrence: how many terms does $a_n$ depend on?", "inline maths in dollars"],
    ["Show that $$\\frac{1}{2} < 1$$ and say why.", "display maths in double dollars"],
    ["No maths at all, just words.", "plain words"],
    ["Use $x^2 + 1$ and then $y_{n+1}$.", "two separate inline pieces"],
    ["", "an empty string"],
  ])("accepts %s (%s)", (text) => {
    expect(mathIsDelimited(text)).toBe(true);
  });

  it.each([
    ["Use \\int_0^1 x dx here.", "a LaTeX command outside dollars"],
    ["The term a_{N+1} is wrong.", "a braced subscript outside dollars"],
    ["The bound 2^{N-1} is wrong.", "a braced power outside dollars"],
    ["Check x^2 + 1 again.", "a bare power outside dollars"],
    ["Check $a_n and carry on", "an unclosed dollar sign"],
    ["Fine $a_n$ but then \\frac{1}{2} outside.", "good maths followed by bad maths"],
  ])("rejects %s (%s)", (text) => {
    expect(mathIsDelimited(text)).toBe(false);
  });

  it("does not mistake a word with an underscore-free dollar amount for maths", () => {
    expect(mathIsDelimited("It costs nothing to check.")).toBe(true);
  });
});
