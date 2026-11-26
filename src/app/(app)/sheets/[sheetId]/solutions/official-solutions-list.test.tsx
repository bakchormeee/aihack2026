import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OfficialSolutionsList } from "./official-solutions-list";

const questions = [
  { id: "a", label: "1", body: "Differentiate x", solution: "The answer is 1." },
  { id: "b", label: "2(a)", body: "Integrate x", solution: null },
];

describe("OfficialSolutionsList", () => {
  it("shows each question folded with its official solution", () => {
    const html = renderToStaticMarkup(<OfficialSolutionsList questions={questions} files={[]} />);
    expect(html).toContain("Question 1");
    expect(html).toContain("The answer is 1.");
    expect(html).toContain("<details");
    expect(html).toContain("1 of 2 questions have an official solution");
  });

  it("says when the uploaded solutions have nothing for a question", () => {
    const html = renderToStaticMarkup(<OfficialSolutionsList questions={questions} files={[]} />);
    expect(html).toContain("Question 2(a)");
    expect(html).toContain("Not in the uploaded solutions");
  });

  it("links to the uploaded file, one link per photo when there are several", () => {
    const one = renderToStaticMarkup(
      <OfficialSolutionsList
        questions={questions}
        files={[{ id: "f1", mime: "application/pdf" }]}
      />,
    );
    expect(one).toContain('href="/api/files/sheet/f1"');
    expect(one).toContain("Open the uploaded solutions");
    const two = renderToStaticMarkup(
      <OfficialSolutionsList
        questions={questions}
        files={[
          { id: "f1", mime: "image/jpeg" },
          { id: "f2", mime: "image/jpeg" },
        ]}
      />,
    );
    expect(two).toContain("Open page 2 of the uploaded solutions");
  });
});
