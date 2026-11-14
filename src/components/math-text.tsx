import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { cn } from "@/lib/utils";

/**
 * remark-math only understands dollar delimiters, but AI output sometimes
 * uses \( \) and \[ \]. Convert those so that both forms render.
 */
export function normaliseMathDelimiters(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `$$${body}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body}$`);
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
