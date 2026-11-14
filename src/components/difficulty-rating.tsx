"use client";

import { useState } from "react";

import { saveRating } from "@/app/(app)/questions/[questionId]/timer-actions";
import { cn } from "@/lib/utils";

type Props = { attemptId: string | null; initialRating: number | null };

/** Optional 1–5 rating of how hard the question felt. Selecting the chosen number again clears it. */
export function DifficultyRating({ attemptId, initialRating }: Props) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [error, setError] = useState(false);

  async function choose(value: number) {
    if (!attemptId) return;
    const next = rating === value ? null : value;
    const previous = rating;
    setRating(next);
    setError(false);
    try {
      await saveRating({ attemptId, rating: next });
    } catch {
      setRating(previous);
      setError(true);
    }
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">How hard was this? (optional)</legend>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Easy</span>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={rating === value}
            disabled={!attemptId}
            onClick={() => void choose(value)}
            className={cn(
              "size-9 rounded-md border text-sm font-medium disabled:opacity-50",
              rating === value ? "bg-foreground text-background" : "hover:bg-muted",
            )}
          >
            {value}
          </button>
        ))}
        <span className="text-muted-foreground text-xs">Hard</span>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          Could not save the rating.
        </p>
      ) : null}
    </fieldset>
  );
}
