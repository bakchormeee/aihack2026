import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("KaTeX versions", () => {
  // The page loads katex/dist/katex.min.css (app/layout.tsx), while rehype-katex
  // renders with its own copy of KaTeX. When the versions differ, the CSS does not
  // match the HTML and fractions overlap.
  it("the stylesheet comes from the KaTeX that rehype-katex renders with", () => {
    const fromRehype = createRequire(require.resolve("rehype-katex"));
    const rendering = fromRehype("katex/package.json") as { version: string };
    const stylesheet = require("katex/package.json") as { version: string };

    expect(stylesheet.version).toBe(rendering.version);
  });
});
