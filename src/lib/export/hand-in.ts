// Page order of the hand-in PDF (pure logic; the browser code is in
// src/components/export-button.tsx). The export holds each question's label
// and the working of its newest submitted attempt, and nothing else: no marks,
// hint record or feedback.

export type HandInQuestion = {
  label: string;
  /** Typed working, or null. */
  text: string | null;
  /** Uploaded files in order; null when the question has no submitted attempt. */
  files: { id: string; mime: string }[] | null;
};

export type PageSpec =
  | { kind: "text"; label: string; continued: boolean; text: string }
  | { kind: "image"; label: string; continued: boolean; fileId: string; mime: string }
  | { kind: "pdf"; label: string; continued: boolean; fileId: string }
  | { kind: "notAttempted"; labels: string[] };

type AttemptInput = {
  startedAt: Date;
  submission: {
    text: string | null;
    submittedAt: Date | null;
    files: { id: string; mime: string; position?: number }[];
  } | null;
};

/** Picks the working of each question's newest submitted attempt. Extra fields on the input are dropped. */
export function buildHandInInput(
  records: { label: string; attempts: AttemptInput[] }[],
): HandInQuestion[] {
  return records.map((record) => {
    const submitted = record.attempts
      .filter((attempt) => attempt.submission?.submittedAt != null)
      .sort((a, b) => {
        const byTime = b.submission!.submittedAt!.getTime() - a.submission!.submittedAt!.getTime();
        return byTime !== 0 ? byTime : b.startedAt.getTime() - a.startedAt.getTime();
      })[0];
    if (!submitted?.submission) return { label: record.label, text: null, files: null };
    const { text, files } = submitted.submission;
    return {
      label: record.label,
      text: text && text.trim().length > 0 ? text : null,
      files: [...files]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(({ id, mime }) => ({ id, mime })),
    };
  });
}

/**
 * The pages of the PDF in order: per question its typed working, then its
 * files (a PDF is merged, a photo takes one page). Questions with no working
 * are listed together on a final "not attempted" page.
 */
export function planHandIn(questions: HandInQuestion[]): PageSpec[] {
  const pages: PageSpec[] = [];
  const notAttempted: string[] = [];

  for (const question of questions) {
    const files = question.files ?? [];
    if (question.text === null && files.length === 0) {
      notAttempted.push(question.label);
      continue;
    }
    let continued = false;
    if (question.text !== null) {
      pages.push({ kind: "text", label: question.label, continued, text: question.text });
      continued = true;
    }
    for (const file of files) {
      pages.push(
        file.mime === "application/pdf"
          ? { kind: "pdf", label: question.label, continued, fileId: file.id }
          : { kind: "image", label: question.label, continued, fileId: file.id, mime: file.mime },
      );
      continued = true;
    }
  }

  if (notAttempted.length > 0) pages.push({ kind: "notAttempted", labels: notAttempted });
  return pages;
}

/** The standard PDF fonts draw Latin-1 only: other characters become "?". */
export function pdfSafeText(text: string): string {
  return Array.from(text)
    .map((char) => (/^[\x20-\x7e\xa0-\xff]$/.test(char) ? char : "?"))
    .join("");
}
