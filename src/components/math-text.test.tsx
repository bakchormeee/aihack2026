import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MathText, normaliseMathDelimiters } from "./math-text";

describe("MathText", () => {
  it("renders inline LaTeX with KaTeX", () => {
    const html = renderToStaticMarkup(<MathText>{"Find $\\frac{1}{2}$ of $x$."}</MathText>);

    expect(html).toContain('class="katex"');
    expect(html).toContain("mfrac");
    expect(html).not.toContain("$");
  });

  it("renders display LaTeX as a block", () => {
    const html = renderToStaticMarkup(<MathText>{"$$\n\\int_0^1 x\\,dx\n$$"}</MathText>);

    expect(html).toContain("katex-display");
  });

  it("renders Markdown structure around the maths", () => {
    const html = renderToStaticMarkup(<MathText>{"**(a)** Show that $x > 0$."}</MathText>);

    expect(html).toContain("<strong>(a)</strong>");
  });

  it("renders an escaped dollar sign inside maths as a dollar sign", () => {
    const html = renderToStaticMarkup(
      <MathText>{"Invest $\\$x$ each year, a total of $\\$21(1.05^n-1)x$."}</MathText>,
    );

    expect(html).not.toContain("katex-error");
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html).toContain("each year, a total of");
  });

  it("keeps an escaped dollar sign outside maths as plain text", () => {
    const html = renderToStaticMarkup(<MathText>{"It costs \\$5 and $x$ more."}</MathText>);

    expect(html).toContain("It costs $5 and");
    expect(html.match(/class="katex"/g)).toHaveLength(1);
  });

  it("does not render raw HTML from the text", () => {
    const html = renderToStaticMarkup(<MathText>{"<script>alert(1)</script> $x$"}</MathText>);

    expect(html).not.toContain("<script>");
  });
});

describe("normaliseMathDelimiters", () => {
  it("converts \\( \\) to inline dollar delimiters", () => {
    expect(normaliseMathDelimiters("Let \\(x = 1\\).")).toBe("Let $x = 1$.");
  });

  it("converts \\[ \\] to display dollar delimiters", () => {
    expect(normaliseMathDelimiters("\\[x^2\\]")).toBe("$$x^2$$");
  });

  it("leaves dollar-delimited maths unchanged", () => {
    expect(normaliseMathDelimiters("$a$ and $$b$$")).toBe("$a$ and $$b$$");
  });

  it("replaces an escaped dollar sign inside maths only", () => {
    expect(normaliseMathDelimiters("$\\$x$ costs \\$5")).toBe("${\\char36}x$ costs \\$5");
  });

  it("keeps a digit after the dollar sign out of the character code", () => {
    expect(normaliseMathDelimiters("$\\$21$")).toBe("${\\char36}21$");
  });

  it("replaces escaped dollar signs inside display maths", () => {
    expect(normaliseMathDelimiters("$$\\$x$$")).toBe("$${\\char36}x$$");
  });

  it("replaces escaped dollar signs inside \\( \\) maths", () => {
    expect(normaliseMathDelimiters("\\(\\$x\\)")).toBe("${\\char36}x$");
  });
});
