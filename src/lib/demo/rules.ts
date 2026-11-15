// Pure rules of the demo account (SPEC-demo.md): how long a copy lives, how many
// copies may exist, how many AI calls a copy may make, and how its times are shifted.

export const DEMO_COPY_HOURS = 24;
export const DEMO_AI_CALLS = 30;
export const DEMO_MAX_COPIES = 200;

const HOUR = 60 * 60 * 1000;

/**
 * The amount, in milliseconds, to add to every template time so that the template's
 * newest activity happens `now`. Zero when the template has no activity.
 */
export function timeShift(newestActivity: Date | null, now: Date): number {
  return newestActivity ? now.getTime() - newestActivity.getTime() : 0;
}

/** When a copy made at `createdAt` is erased. */
export function expiryOf(createdAt: Date): Date {
  return new Date(createdAt.getTime() + DEMO_COPY_HOURS * HOUR);
}

/** A copy is expired from its expiry time on; one without an expiry always is. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || now.getTime() >= expiresAt.getTime();
}

export type DemoCopyInfo = { id: string; createdAt: Date; expiresAt: Date | null };

/**
 * The copies to erase before a new one is made: every expired copy, then the oldest
 * live copies until there is room for one more under `max`.
 */
export function copiesToErase(
  copies: DemoCopyInfo[],
  now: Date,
  max: number = DEMO_MAX_COPIES,
): string[] {
  const expired = copies.filter((c) => isExpired(c.expiresAt, now)).map((c) => c.id);
  const live = copies
    .filter((c) => !isExpired(c.expiresAt, now))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const over = Math.max(0, live.length - (max - 1));
  return [...expired, ...live.slice(0, over).map((c) => c.id)];
}

/** AI calls a copy may still make after `used` calls. */
export function aiCallsLeft(used: number): number {
  return Math.max(0, DEMO_AI_CALLS - used);
}
