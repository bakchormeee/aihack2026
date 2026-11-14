"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { disputeAction, type DisputeResult } from "./actions";

export function DisputeForm({
  questionId,
  attemptId,
  remaining,
}: {
  questionId: string;
  attemptId: string;
  remaining: number;
}) {
  const [state, action, pending] = useActionState<DisputeResult, FormData>(
    disputeAction.bind(null, questionId, attemptId),
    {},
  );

  return (
    <form action={action} className="bg-card flex flex-col gap-3 rounded-lg border p-5">
      <Label htmlFor="dispute-reason">
        Do you think your working is right? Ask for another look ({remaining} left).
      </Label>
      <Input
        id="dispute-reason"
        name="reason"
        maxLength={300}
        placeholder="Why? (optional, one line)"
        disabled={pending}
      />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Asking…" : "I think this is right"}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
