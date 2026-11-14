import { STALE_JOB_MS } from "@/lib/domain";

/** True when a job has been waiting longer than STALE_JOB_MS: it is shown as failed, with a retry. */
export function isStale(statusUpdatedAt: Date | null, now: Date = new Date()): boolean {
  return statusUpdatedAt !== null && now.getTime() - statusUpdatedAt.getTime() > STALE_JOB_MS;
}
