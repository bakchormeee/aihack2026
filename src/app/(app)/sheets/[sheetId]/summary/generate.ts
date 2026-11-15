import { after } from "next/server";

import {
  claimSummary,
  failSummary,
  finishSummary,
  getSheetSummaryInput,
  readSummary,
  summaryIsStale,
} from "@/db/queries/history";
import { withAiUser } from "@/lib/ai/budget";
import { summariseSheet } from "@/lib/ai/summarise-sheet";

type SummaryBody = { wentWell: string[]; wasHard: string[]; nextSteps: string[] };

export type SummaryState =
  | { kind: "waiting"; remaining: number; total: number }
  | { kind: "generating"; ladder: [number, number, number, number] }
  | { kind: "failed"; ladder: [number, number, number, number] }
  | { kind: "ready"; body: SummaryBody; ladder: [number, number, number, number] };

/**
 * What the Summary tab shows, starting the AI summary in the background when
 * it is needed: every question has a marked attempt and there is no summary,
 * or a mark is newer than the stored one. A claim in the database makes sure
 * two page loads do not both call the AI.
 */
export async function startSummaryIfNeeded(
  userId: string,
  sheetId: string,
  schedule: (job: () => Promise<void>) => void = (job) => after(job),
): Promise<SummaryState> {
  const input = await getSheetSummaryInput(userId, sheetId);
  if (!input.complete) {
    return { kind: "waiting", remaining: input.total - input.marked, total: input.total };
  }

  const stored = await readSummary(userId, sheetId);
  if (stored?.state === "failed") return { kind: "failed", ladder: input.ladder };
  if (stored?.state === "ready" && !summaryIsStale(stored.generatedAt, input.newestMarkAt)) {
    return { kind: "ready", body: stored.body, ladder: input.ladder };
  }

  const claimedAt =
    stored?.state === "generating" ? null : await claimSummary(userId, sheetId, input.newestMarkAt);
  if (claimedAt) {
    schedule(() =>
      withAiUser(userId, async () => {
        try {
          await finishSummary(sheetId, claimedAt, await summariseSheet({ items: input.items }));
        } catch (error) {
          console.error("Sheet summary failed", error);
          await failSummary(sheetId, claimedAt);
        }
      }),
    );
  }
  // Without a claim of our own, someone else has the job, or the summary is being replaced.
  return { kind: "generating", ladder: input.ladder };
}
