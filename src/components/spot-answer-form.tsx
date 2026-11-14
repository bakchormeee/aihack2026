"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitSpotAnswerAction } from "@/app/(app)/revise/[sessionId]/spot/actions";
import { MAX_EXPLANATION } from "@/lib/spot/rules";

/** The numbered solution: tick the lines you think are wrong and say why, or press No error. */
export function SpotAnswerForm({
  sessionId,
  position,
  lines,
}: {
  sessionId: string;
  position: number;
  lines: string[];
}) {
  const router = useRouter();
  // A ticked line has an entry, holding the explanation typed so far.
  const [ticked, setTicked] = useState<Record<number, string>>({});
  const [noError, setNoError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleLine(line: number) {
    setNoError(false);
    setTicked((current) => {
      const next = { ...current };
      if (line in next) delete next[line];
      else next[line] = "";
      return next;
    });
  }

  function toggleNoError() {
    setNoError((current) => !current);
    setTicked({});
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitSpotAnswerAction({
        sessionId,
        position,
        noError,
        ticked: Object.entries(ticked).map(([line, explanation]) => ({
          line: Number(line),
          explanation,
        })),
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        This solution may contain errors. Tick every line you think is wrong and say what is wrong
        in it, or press No error.
      </p>
      <ol className="flex flex-col gap-2">
        {lines.map((text, index) => {
          const line = index + 1;
          const isTicked = line in ticked;
          return (
            <li
              key={line}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${isTicked ? "border-red-600 bg-red-500/10" : ""}`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1.5 size-4"
                  checked={isTicked}
                  onChange={() => toggleLine(line)}
                  aria-label={`Line ${line} is wrong`}
                />
                <span className="text-muted-foreground mt-0.5 w-5 shrink-0 text-sm">{line}.</span>
                <MathText className="min-w-0 text-sm">{text}</MathText>
              </label>
              {isTicked ? (
                <div className="flex flex-col gap-1 pl-12">
                  <label htmlFor={`why-${line}`} className="text-xs font-medium">
                    What is wrong in line {line}?
                  </label>
                  <Textarea
                    id={`why-${line}`}
                    value={ticked[line]}
                    maxLength={MAX_EXPLANATION}
                    onChange={(event) =>
                      setTicked((current) => ({ ...current, [line]: event.target.value }))
                    }
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant={noError ? "default" : "outline"}
          aria-pressed={noError}
          onClick={toggleNoError}
        >
          No error
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Checking your answer…" : "Submit answer"}
        </Button>
      </div>
    </form>
  );
}
