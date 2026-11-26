// What happens to a working submission the moment it is submitted (SPEC-study-views.md,
// mark-on-official). The three submit paths (one question, "Submit all drafts", the batch
// upload) all end here, so they follow one rule: `markingPlan`.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { attempts, sheets, solutions, submissions } from "@/db/schema";
import { requireSheet } from "@/lib/auth/ownership";
import { markingPlan } from "@/lib/marking/plan";

import { claimMark, holdForOfficial, type ClaimedMark } from "./mark";

/**
 * The position of the "Mark with AI now" switch for a submit: what the form sent, else the
 * sheet's last position. A position that was sent is saved on the sheet, so turning the switch
 * off once covers the rest of the sheet. A question without a sheet (a revision variant) has no
 * stored position and marks with the AI unless told otherwise.
 */
export async function resolveMarkWithAi(
  userId: string,
  sheetId: string | null,
  requested: boolean | undefined,
): Promise<boolean> {
  if (sheetId === null) return requested ?? true;
  const sheet = await requireSheet(userId, sheetId);
  if (requested === undefined) return sheet.markWithAi;
  if (requested !== sheet.markWithAi)
    await db.update(sheets).set({ markWithAi: requested }).where(eq(sheets.id, sheetId));
  return requested;
}

/**
 * Applies the marking plan to freshly submitted submissions, on the server, from the database:
 * a question with an official solution is claimed for an official mark whatever the switch says,
 * otherwise the switch decides between an AI mark and waiting (status `awaiting_official`, no AI
 * call). Returns the claims the caller must run with `performMark`, for example in `after()`.
 */
export async function startMarking(
  submissionIds: string[],
  markWithAi: boolean,
): Promise<ClaimedMark[]> {
  if (submissionIds.length === 0) return [];
  const rows = await db
    .select({ submissionId: submissions.id, questionId: attempts.questionId })
    .from(submissions)
    .innerJoin(attempts, eq(submissions.attemptId, attempts.id))
    .where(inArray(submissions.id, submissionIds));
  const official = new Set(
    (
      await db
        .select({ questionId: solutions.questionId })
        .from(solutions)
        .where(
          and(
            eq(solutions.basis, "official"),
            inArray(
              solutions.questionId,
              rows.map((row) => row.questionId),
            ),
          ),
        )
    ).map((row) => row.questionId),
  );

  const claims: ClaimedMark[] = [];
  for (const { submissionId, questionId } of rows) {
    const plan = markingPlan({ hasOfficial: official.has(questionId), markWithAi });
    if (plan === "wait") {
      await holdForOfficial(submissionId);
      continue;
    }
    const claim = await claimMark({ submissionId, basis: plan });
    if (claim) claims.push(claim);
  }
  return claims;
}
