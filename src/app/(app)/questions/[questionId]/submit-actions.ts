"use server";

import { after } from "next/server";
import { z } from "zod";

import { keyIsUnder } from "@/db/queries/sheets";
import {
  EmptyWorkingError,
  SubmissionLockedError,
  WorkingFilesError,
  addDraftFiles,
  getWorkingFor,
  removeDraftFile,
  saveDraftText,
  submitWorking,
} from "@/db/queries/working";
import { requireUser } from "@/lib/auth/session";
import { claimMark, performMark } from "@/lib/pipeline/mark";
import { UploadRejectedError, deleteObject, verifyUploadedObject } from "@/lib/storage";

const attemptSchema = z.object({ attemptId: z.string().min(1).max(100) });

export type WorkingFile = { id: string; mime: string };
export type ActionResult = { ok: true } | { ok: false; error: string };
export type FilesResult = { ok: true; files: WorkingFile[] } | { ok: false; error: string };

/** Turns the errors a student can cause into a message; anything else is a real bug and is thrown. */
function friendly(error: unknown): { ok: false; error: string } {
  if (
    error instanceof SubmissionLockedError ||
    error instanceof EmptyWorkingError ||
    error instanceof WorkingFilesError ||
    error instanceof UploadRejectedError ||
    error instanceof RangeError
  ) {
    return { ok: false, error: error.message };
  }
  throw error;
}

const toFiles = (files: { id: string; mime: string }[]): WorkingFile[] =>
  files.map((file) => ({ id: file.id, mime: file.mime }));

export async function saveDraftTextAction(input: {
  attemptId: string;
  text: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const { attemptId, text } = attemptSchema.extend({ text: z.string() }).parse(input);
  try {
    await saveDraftText(user.id, attemptId, text);
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}

/** Attaches files the browser has already uploaded to the attempt's draft. */
export async function addWorkingFilesAction(input: {
  attemptId: string;
  keys: string[];
}): Promise<FilesResult> {
  const user = await requireUser();
  const { attemptId, keys } = attemptSchema
    .extend({ keys: z.array(z.string().min(1)).min(1).max(10) })
    .parse(input);

  if (!keys.every((key) => keyIsUnder(key, user.id, "working", attemptId))) {
    return { ok: false, error: "Those files were not uploaded for this attempt." };
  }

  const verified = [];
  try {
    for (const key of keys) verified.push(await verifyUploadedObject(user.id, key));
    await addDraftFiles(
      user.id,
      attemptId,
      verified.map((file) => ({ path: file.key, mime: file.mime })),
    );
  } catch (error) {
    // Do not leave unattached files behind in storage.
    await Promise.all(keys.map((key) => deleteObject(key).catch(() => {})));
    return friendly(error);
  }
  return { ok: true, files: toFiles((await getWorkingFor(user.id, attemptId)).files) };
}

export async function removeWorkingFileAction(input: {
  attemptId: string;
  fileId: string;
}): Promise<FilesResult> {
  const user = await requireUser();
  const { attemptId, fileId } = attemptSchema
    .extend({ fileId: z.string().min(1).max(100) })
    .parse(input);
  try {
    const path = await removeDraftFile(user.id, fileId);
    if (path) await deleteObject(path).catch(() => {});
  } catch (error) {
    return friendly(error);
  }
  return { ok: true, files: toFiles((await getWorkingFor(user.id, attemptId)).files) };
}

/** Submits the attempt's working and starts the AI marking in the background. */
export async function submitWorkingAction(input: { attemptId: string }): Promise<ActionResult> {
  const user = await requireUser();
  const { attemptId } = attemptSchema.parse(input);
  try {
    const { submissionId, alreadySubmitted } = await submitWorking(user.id, attemptId);
    if (!alreadySubmitted) {
      // Claim now so the mark screen shows "marking" at once; the AI call runs afterwards.
      const claim = await claimMark({ submissionId, basis: "ai" });
      if (claim) after(() => performMark(claim));
    }
    return { ok: true };
  } catch (error) {
    return friendly(error);
  }
}
