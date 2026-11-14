// Storage keys. The server chooses every key, so a client can never pick a
// path. Layout: u/<userId>/<purpose>/<parentId>/<uuid>.<ext>
// Frozen after task F5.

export const UPLOAD_PURPOSES = ["sheet", "official_solutions", "working"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extensionForMime(mime: string): string | null {
  return EXTENSIONS[mime] ?? null;
}

// Ids are uuids or Auth.js ids; anything with a slash or dot is refused.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function buildKey(i: {
  userId: string;
  purpose: UploadPurpose;
  parentId: string;
  mime: string;
}): string {
  const ext = extensionForMime(i.mime);
  if (!ext) throw new Error(`File type ${i.mime} is not accepted`);
  if (!SAFE_ID.test(i.userId) || !SAFE_ID.test(i.parentId))
    throw new Error("Invalid id in storage key");
  return `u/${i.userId}/${i.purpose}/${i.parentId}/${crypto.randomUUID()}.${ext}`;
}

/** Throws unless `key` is inside the user's own folder. */
export function assertOwnedKey(userId: string, key: string): void {
  const ok =
    typeof key === "string" &&
    key.startsWith(`u/${userId}/`) &&
    !key.split("/").some((part) => part === ".." || part === ".");
  if (!ok) throw new Error("Storage key is not owned by this user");
}
