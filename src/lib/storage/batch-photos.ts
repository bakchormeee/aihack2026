// The photos of working for several questions (purpose `batch`, SPEC-batch-working.md)
// are kept only until the student confirms or cancels. Server only.

import { deleteObject, listObjects } from "./s3";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The folder that holds one sheet's batch photos (see buildKey). */
export function batchPhotoPrefix(userId: string, sheetId: string): string {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(sheetId)) throw new Error("Invalid id in storage key");
  return `u/${userId}/batch/${sheetId}/`;
}

/**
 * Deletes the sheet's batch photos: all of them, or with `olderThan` only those
 * uploaded before it (so a review still open in another tab keeps its photos).
 * Returns how many were deleted.
 */
export async function deleteBatchPhotos(
  userId: string,
  sheetId: string,
  opts: { olderThan?: Date } = {},
): Promise<number> {
  const { olderThan } = opts;
  const listed = await listObjects(batchPhotoPrefix(userId, sheetId));
  const keys = listed
    .filter((o) => !olderThan || !o.lastModified || o.lastModified < olderThan)
    .map((o) => o.key);
  await Promise.all(keys.map((key) => deleteObject(key)));
  return keys.length;
}

/** Photos younger than this may belong to a review that is still open. */
export const LEFTOVER_BATCH_PHOTO_MS = 60 * 60 * 1000;

/** The sheet page's clean-up: batch photos left for more than an hour. */
export function deleteLeftoverBatchPhotos(
  userId: string,
  sheetId: string,
  now = new Date(),
): Promise<number> {
  return deleteBatchPhotos(userId, sheetId, {
    olderThan: new Date(now.getTime() - LEFTOVER_BATCH_PHOTO_MS),
  });
}
