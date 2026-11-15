import { NextResponse } from "next/server";
import { z } from "zod";

import { NotFoundError, requireAttempt, requireCourse, requireSheet } from "@/lib/auth/ownership";
import { getCurrentUser } from "@/lib/auth/session";
import { ACCEPTED_IMAGE_MIMES, buildKey, UPLOAD_PURPOSES, validateUpload } from "@/lib/storage";
import { presignUpload } from "@/lib/storage/s3";

const bodySchema = z.object({
  purpose: z.enum(UPLOAD_PURPOSES),
  // sheet: the course id; official_solutions and batch: the sheet id; working: the attempt id.
  parentId: z.string().min(1).max(100),
  mime: z.string().min(1).max(100),
  size: z.number(),
});

/** Gives the browser a URL to upload one file to. The server picks the key. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { purpose, parentId, mime, size } = parsed.data;

  const check = validateUpload({ mime, size });
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
  if (purpose === "batch" && !(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(mime))
    return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });

  try {
    if (purpose === "sheet") await requireCourse(user.id, parentId);
    else if (purpose === "official_solutions" || purpose === "batch")
      await requireSheet(user.id, parentId);
    else await requireAttempt(user.id, parentId);
  } catch (error) {
    if (error instanceof NotFoundError)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    throw error;
  }

  const key = buildKey({ userId: user.id, purpose, parentId, mime });
  return NextResponse.json({ key, url: await presignUpload(key, mime) });
}
