// Text shared by every AI prompt in this folder.

/** How the model must write mathematics. `<MathText>` renders exactly this format. */
export const MATH_FORMAT = String.raw`Formatting rules for every text field you write:
- Write in Markdown.
- Write all mathematics as LaTeX: inline maths inside $…$ and display maths inside $$…$$ on its own line. Do not use \( \), \[ \] or plain-text maths such as x^2.
- Inside JSON strings every LaTeX backslash must be escaped once, so that the parsed text reads \frac{1}{2}, not frac{1}{2}.
- Write for a university mathematics student. Use British spelling.`;
