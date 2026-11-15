import Link from "next/link";

import { Panel } from "@/components/page-parts";

/** Shown after a course or a sheet was deleted (`?deleted=1`). */
export function DeletedNotice() {
  return (
    <Panel role="status" className="flex flex-wrap items-center justify-between gap-2 py-3">
      <p>Moved to Recently deleted.</p>
      <Link href="/courses/deleted" className="text-sm underline underline-offset-4">
        Recently deleted
      </Link>
    </Panel>
  );
}
