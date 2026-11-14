// Marker text must write every piece of maths as LaTeX inside $...$ (SPEC-marking-v2.md),
// because the screens render only what is inside the dollar signs. This check
// rejects text that has LaTeX outside them, so it can be sent back for a rewrite.

/** True when no LaTeX appears outside $...$ or $$...$$, and every dollar sign is closed. */
export function mathIsDelimited(text: string): boolean {
  // Remove the delimited maths: display first, then inline.
  const outside = text.replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$[^$]*\$/g, " ");
  if (outside.includes("$")) return false; // an unclosed dollar sign

  const looksLikeMaths = [
    /\\[A-Za-z]+/, // a LaTeX command such as \int or \frac
    /[_^]\{/, // a braced subscript or power
    /[A-Za-z0-9)\]}][_^][A-Za-z0-9(]/, // a bare power or subscript such as x^2 or a_n
  ];
  return !looksLikeMaths.some((pattern) => pattern.test(outside));
}
