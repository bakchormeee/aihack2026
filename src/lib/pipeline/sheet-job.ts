// What runs in the background after a sheet is uploaded or retried:
// read the sheet, then prepare the hints for its questions.

import { runHintsForSheet } from "./hints";
import { runParse } from "./parse";

export async function runSheetPipeline(sheetId: string): Promise<void> {
  await runParse(sheetId);
  await runHintsForSheet(sheetId);
}
