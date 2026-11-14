// Call this in a server action before saving a row that points at an
// uploaded file. A file that does not pass is deleted. Frozen after task F5.

import { assertOwnedKey } from "./keys";
import { validateUpload } from "./limits";
import { deleteObject, statObject } from "./s3";

export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

/** Checks that `key` is the user's, exists, and has an accepted type and size. Returns what storage says. */
export async function verifyUploadedObject(
  userId: string,
  key: string,
): Promise<{ key: string; mime: string; size: number }> {
  try {
    assertOwnedKey(userId, key);
  } catch {
    throw new UploadRejectedError("That file does not belong to you.");
  }

  const stat = await statObject(key);
  if (!stat) throw new UploadRejectedError("The upload did not finish. Please try again.");

  const check = validateUpload(stat);
  if (!check.ok) {
    await deleteObject(key);
    throw new UploadRejectedError(check.message);
  }
  return { key, mime: stat.mime, size: stat.size };
}
