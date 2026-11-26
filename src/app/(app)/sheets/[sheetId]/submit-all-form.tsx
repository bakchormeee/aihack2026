"use client";

import Link from "next/link";
import { useState } from "react";

import { MarkWithAiSwitch } from "@/components/mark-with-ai-switch";
import { Button, buttonVariants } from "@/components/ui/button";

import { submitAllAction } from "./actions";

/** The bar above the question list: batch upload, and Submit all drafts with its AI switch. */
export function SubmitAllForm({
  sheetId,
  initialMarkWithAi,
  total,
  official,
}: {
  sheetId: string;
  initialMarkWithAi: boolean;
  /** Questions without submitted working, and how many of them have an official solution. */
  total: number;
  official: number;
}) {
  const [aiNow, setAiNow] = useState(initialMarkWithAi);
  return (
    <form
      action={submitAllAction.bind(null, sheetId)}
      className="flex flex-wrap items-start gap-x-4 gap-y-3"
    >
      <Link href={`/sheets/${sheetId}/batch`} className={buttonVariants()}>
        Upload working for several questions
      </Link>
      <Button type="submit" variant="outline">
        Submit all drafts
      </Button>
      <input type="hidden" name="markWithAi" value={aiNow ? "true" : "false"} />
      <MarkWithAiSwitch
        checked={aiNow}
        onCheckedChange={setAiNow}
        total={total}
        official={official}
      />
      <span className="text-muted-foreground w-full text-sm">
        Submits the working you have written or attached on any question but not yet submitted.
      </span>
    </form>
  );
}
