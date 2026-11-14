// Where "Next" leads. Task V3 extends the session case to pick the next
// unanswered item; until then a session link goes back to the session page.

import { getSheetNeighbours } from "@/db/queries/attempts";

export async function getNextHref(i: {
  userId: string;
  questionId: string;
  sessionId?: string;
}): Promise<string> {
  if (i.sessionId) return `/revise/${i.sessionId}`;

  const { sheetId, nextId } = await getSheetNeighbours(i.userId, i.questionId);
  if (nextId) return `/questions/${nextId}`;
  return sheetId ? `/sheets/${sheetId}` : "/courses";
}
