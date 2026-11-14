// For pages: turns the NotFoundError thrown by an ownership helper into the
// 404 page. Use it as `await orNotFound(requireSheet(user.id, sheetId))`.

import { notFound } from "next/navigation";

import { NotFoundError } from "./ownership";

export async function orNotFound<T>(lookup: Promise<T>): Promise<T> {
  try {
    return await lookup;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
