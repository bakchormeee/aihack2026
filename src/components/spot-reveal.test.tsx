import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpotReveal } from "./spot-reveal";

const lines = ["First step $a$.", "Second step $3-2+8$.", "Third step $b$.", "Fourth step $c$."];
const planted = [
  {
    line: 2,
    whatsWrong: "The minus changes both terms.",
    correctLine: "Second step $3-2-8$.",
    misconception: "Drops the sign after a minus bracket.",
  },
];

describe("SpotReveal", () => {
  it("shows the outcome, the planted line with what is wrong, the correct line and the misconception", () => {
    const html = renderToStaticMarkup(
      <SpotReveal
        lines={lines}
        planted={planted}
        ticked={[{ line: 2, explanation: "Both terms flip." }]}
        judgements={[{ line: 2, right: true, comment: "Yes, both flip." }]}
        noError={false}
        outcome="full"
      />,
    );

    expect(html).toContain("Correct");
    expect(html).toContain("The minus changes both terms.");
    expect(html).toContain("Correct line");
    expect(html).toContain("Based on your common error");
    expect(html).toContain("Drops the sign after a minus bracket.");
    expect(html).toContain("Both terms flip."); // the student's own explanation
    expect(html).toContain("Yes, both flip."); // the verdict
    expect(html).toContain("You found this");
    expect(html).toContain('class="katex"');
  });

  it("says a wrongly ticked line was correct, and that a missed planted line was not ticked", () => {
    const html = renderToStaticMarkup(
      <SpotReveal
        lines={lines}
        planted={planted}
        ticked={[{ line: 3, explanation: "Looks off." }]}
        judgements={[]}
        noError={false}
        outcome="stuck"
      />,
    );

    expect(html).toContain("This line was correct");
    expect(html).toContain("You did not tick this line");
    expect(html).toContain("Stuck");
  });

  it("shows a wrong explanation of the right line with the verdict", () => {
    const html = renderToStaticMarkup(
      <SpotReveal
        lines={lines}
        planted={planted}
        ticked={[{ line: 2, explanation: "Arithmetic." }]}
        judgements={[{ line: 2, right: false, comment: "Not quite." }]}
        noError={false}
        outcome="stuck"
      />,
    );

    expect(html).toContain("Not quite.");
    expect(html).toContain("Your explanation did not match");
  });

  it("says a clean solution had no error, whether the student said so or not", () => {
    const right = renderToStaticMarkup(
      <SpotReveal lines={lines} planted={[]} ticked={[]} judgements={[]} noError outcome="full" />,
    );
    expect(right).toContain("This solution had no error");
    expect(right).toContain("Correct");

    const wrong = renderToStaticMarkup(
      <SpotReveal
        lines={lines}
        planted={[]}
        ticked={[{ line: 1, explanation: "x" }]}
        judgements={[]}
        noError={false}
        outcome="stuck"
      />,
    );
    expect(wrong).toContain("This solution had no error");
    expect(wrong).toContain("This line was correct");
  });

  it("says No error was wrong when there was an error", () => {
    const html = renderToStaticMarkup(
      <SpotReveal
        lines={lines}
        planted={planted}
        ticked={[]}
        judgements={[]}
        noError
        outcome="stuck"
      />,
    );

    expect(html).toContain("You said there was no error");
  });
});
