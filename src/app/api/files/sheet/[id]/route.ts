import { NextResponse } from "next/server";

import { NotFoundError, requireSheetFile } from "@/lib/auth/ownership";
import { getCurrentUser } from "@/lib/auth/session";
import { signedDownloadUrl } from "@/lib/storage/s3";

/** Redirects to a short-lived URL for a sheet or official-solutions file the user owns. */
export async function GET(_request: Request, { params }: RouteContext<"/api/files/sheet/[id]">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;

  try {
    const file = await requireSheetFile(user.id, id);
    const response = NextResponse.redirect(await signedDownloadUrl(file.path), 302);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof NotFoundError)
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    throw error;
  }
}
