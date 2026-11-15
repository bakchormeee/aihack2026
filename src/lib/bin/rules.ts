// Pure rules of the bin (SPEC-delete.md): what a binned sheet takes with it, when an
// item is erased, and what the delete dialog says.

export const BIN_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

type QuestionLink = { id: string; sheetId: string | null; parentQuestionId: string | null };

/**
 * The questions that go with the binned sheets: every question on one of them, and every
 * revision variant whose chain of parents reaches one of those questions.
 */
export function binnedQuestionIds(
  questions: QuestionLink[],
  binnedSheetIds: Set<string>,
): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const result = new Set<string>();
  for (const question of questions) {
    const seen = new Set<string>();
    let current: QuestionLink | undefined = question;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.sheetId !== null && binnedSheetIds.has(current.sheetId)) {
        result.add(question.id);
        break;
      }
      current = current.parentQuestionId ? byId.get(current.parentQuestionId) : undefined;
    }
  }
  return result;
}

/** When an item deleted at `deletedAt` is erased for good. */
export function eraseDate(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + BIN_DAYS * DAY);
}

/** An item is erased from exactly 30 days after it was deleted. */
export function isDueForErasing(deletedAt: Date, now: Date): boolean {
  return now.getTime() >= eraseDate(deletedAt).getTime();
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The delete dialog's sentence. A zero count is left out. */
export function deleteSentence(i: {
  kind: "course" | "sheet";
  name: string;
  sheets: number;
  questions: number;
  attempts: number;
}): string {
  const parts = [
    i.kind === "course" && i.sheets > 0 ? count(i.sheets, "sheet") : null,
    i.questions > 0 ? count(i.questions, "question") : null,
    i.attempts > 0 ? count(i.attempts, "attempt") : null,
  ].filter((p): p is string => p !== null);
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const what = list ? `${i.name} with its ${list}` : i.name;
  return `This deletes ${what}. You can restore it from Recently deleted for ${BIN_DAYS} days.`;
}
