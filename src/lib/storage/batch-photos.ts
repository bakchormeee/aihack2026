// The photos of working for several questions (purpose `batch`, SPEC-batch-working.md)
// are kept only until the student confirms or cancels. Server only.

import { deleteObject, listObjects } from "./s3";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The folder that holds one sheet's batch photos (see buildKey). */
export function batchPhotoPrefix(userId: string, sheetId: string): string {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(sheetId))
    throw new Error("Invalid id in storage key");
  return `u/${userId}/batch/${sheetId}/`;
}

/** Deletes every batch photo of the sheet. Returns how many were deleted. */
export async function deleteBatchPhotos(userId: string, sheetId: string): Promise<number> {
  const keys = await listObjects(batchPhotoPrefix(userId, sheetId));
  await Promise.all(keys.map((key) => deleteObject(key)));
  return keys.length;
}
