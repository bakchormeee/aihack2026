// Where "Next" leads. Inside a revision session it is the next item that is
// not done; outside one it is the next question on the sheet.

import { getSheetNeighbours } from "@/db/queries/attempts";
import { getRevisionSession } from "@/db/queries/revision";
import { NotFoundError } from "@/lib/auth/ownership";

export async function getNextHref(i: {
  userId: string;
  questionId: string;
  sessionId?: string;
}): Promise<string> {
  if (i.sessionId) return nextInSession(i.userId, i.questionId, i.sessionId);

  const { sheetId, nextId } = await getSheetNeighbours(i.userId, i.questionId);
  if (nextId) return `/questions/${nextId}`;
  return sheetId ? `/sheets/${sheetId}` : "/courses";
}

/** The next item after this question that is not done, else the first one that is not, else the session page. */
async function nextInSession(userId: string, questionId: string, sessionId: string) {
  try {
    const { items } = await getRevisionSession(userId, sessionId);
    const current = items.findIndex((item) => item.questionId === questionId);
    const open = items.filter((item) => !item.done && item.questionId !== questionId);
    const next = open.find((item) => items.indexOf(item) > current) ?? open[0];
    return next ? `/questions/${next.questionId}?session=${sessionId}` : `/revise/${sessionId}`;
  } catch (error) {
    if (error instanceof NotFoundError) return "/courses";
    throw error;
  }
}
