// The score of a sheet, counting only the questions the student attempted
// (SPEC-study-views.md, attempted-score). Pure: callers pass each part's mark, worked out
// by the one "mark of a question" rule in src/db/queries/history.ts.

/** Marks are out of 5 (same value as MAX_SCORE in src/lib/marking/rules.ts). */
const MAX_MARK = 5;

/** One part of a question as stored: its label ("2(a)") and its mark, or null when it has none. */
export type PartMark = { label: string; mark: number | null };

/** The numbered question a label belongs to: the text before the first "(", trimmed. */
export function questionNumber(label: string): string {
  const open = label.indexOf("(");
  return (open === -1 ? label : label.slice(0, open)).trim();
}

export type NumberedQuestion = {
  number: string;
  /** Mean of the marked parts, to one decimal; null when no part is marked. */
  mark: number | null;
  /** Labels of the parts that have a mark, in order. */
  markedLabels: string[];
  /** Number of parts, marked or not. */
  parts: number;
};

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/** Groups parts into numbered questions, in order of first appearance. */
export function numberedQuestions(parts: PartMark[]): NumberedQuestion[] {
  const groups = new Map<string, PartMark[]>();
  for (const part of parts) {
    const number = questionNumber(part.label);
    groups.set(number, [...(groups.get(number) ?? []), part]);
  }
  return [...groups].map(([number, group]) => {
    const marked = group.filter(
      (part): part is { label: string; mark: number } => part.mark !== null,
    );
    return {
      number,
      mark: marked.length
        ? oneDecimal(marked.reduce((sum, part) => sum + part.mark, 0) / marked.length)
        : null,
      markedLabels: marked.map((part) => part.label),
      parts: group.length,
    };
  });
}

export type SheetScore = {
  /** Numbered questions with at least one marked part. */
  attempted: number;
  /** All numbered questions on the sheet. */
  total: number;
  /** Sum of the attempted questions' marks. */
  points: number;
  /** 5 for each attempted question. */
  max: number;
  /** Whole percent; null when nothing is marked. */
  percent: number | null;
};

export function sheetScore(parts: PartMark[]): SheetScore {
  const questions = numberedQuestions(parts);
  const attempted = questions.filter((question) => question.mark !== null);
  const points = oneDecimal(attempted.reduce((sum, question) => sum + question.mark!, 0));
  const max = attempted.length * MAX_MARK;
  return {
    attempted: attempted.length,
    total: questions.length,
    points,
    max,
    percent: max > 0 ? Math.round((points / max) * 100) : null,
  };
}

/** "9 / 10 (90%)", or "–" when nothing is marked. */
export function formatScore(score: SheetScore): string {
  return score.percent === null ? "–" : `${score.points} / ${score.max} (${score.percent}%)`;
}

/** "Attempted 2 / 4". */
export function formatAttempted(score: SheetScore): string {
  return `Attempted ${score.attempted} / ${score.total}`;
}

/**
 * Which questions the Summary covers: "Based on questions 1, 2(a) and 4". A question with only
 * some parts marked is named by those parts. Empty when nothing is marked.
 */
export function coverageText(parts: PartMark[]): string {
  const names = numberedQuestions(parts)
    .filter((question) => question.mark !== null)
    .flatMap((question) =>
      question.markedLabels.length === question.parts ? [question.number] : question.markedLabels,
    );
  if (names.length === 0) return "";
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Based on ${names.length === 1 ? "question" : "questions"} ${list}`;
}

/** The score line above a sheet's tabs: "17 / 25" large, then the detail beside it. */
export function scoreLine(score: SheetScore): { big: string | null; detail: string } {
  if (score.percent === null) {
    return {
      big: null,
      detail: `Attempted ${score.attempted} of ${score.total} questions · no marks yet`,
    };
  }
  return {
    big: `${score.points} / ${score.max}`,
    detail: `${score.percent}% · attempted ${score.attempted} of ${score.total} questions`,
  };
}
