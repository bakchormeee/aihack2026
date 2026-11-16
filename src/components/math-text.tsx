import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

/**
 * remark-math only understands dollar delimiters, but AI output sometimes
 * uses \( \) and \[ \]. Convert those so that both forms render.
 */
export function normaliseMathDelimiters(text: string): string {
  return escapeDollarsInMath(
    text
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `$$${body}$$`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body}$`),
  );
}

/** A dollar sign KaTeX draws, with no `$` in it. The braces stop a digit after it joining the code. */
const MATH_DOLLAR = "{\\char36}";

/**
 * Money in maths is written `$\$x$`, but remark-math ends the maths at the `$` of
 * `\$`. Inside maths, replace `\$` with a dollar sign KaTeX draws instead. Outside
 * maths `\$` is Markdown's literal dollar, so it is kept.
 */
function escapeDollarsInMath(text: string): string {
  let out = "";
  let open = 0; // the length of the `$` run that opened the current maths, 0 outside maths
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && text[i + 1] === "$") {
      out += open > 0 ? MATH_DOLLAR : "\\$";
      i += 2;
      continue;
    }
    if (text[i] === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      let run = 0;
      while (text[i + run] === "$") run++;
      if (open === 0) open = run;
      else if (run === open) open = 0;
      out += "$".repeat(run);
      i += run;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

type MathTextProps = {
  children: string;
  className?: string;
};

/** Renders Markdown with inline ($…$) and display ($$…$$) LaTeX. Raw HTML in the text is not rendered. */
export function MathText({ children, className }: MathTextProps) {
  return (
    <div className={cn("math-text", className)}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normaliseMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
