"use client";

import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import { startDemo, type DemoStartState } from "./actions";

// Submits itself once the page has loaded, so a judge lands in the demo at once, while
// link-preview bots that run no JavaScript never create a copy.
export function DemoStart() {
  const [state, action, pending] = useActionState<DemoStartState>(startDemo, null);
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    form.current?.requestSubmit();
  }, []);

  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      {state?.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {pending ? "Opening the demo…" : "Preparing a private copy of the demo student."}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {state?.error ? "Try again" : "Open the demo"}
      </Button>
    </form>
  );
}
