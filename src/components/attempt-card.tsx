import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import type { AttemptRecord } from "@/db/queries/history";
import type { Outcome } from "@/lib/domain";
import { ERROR_LABEL } from "@/lib/marking/labels";

// Re-exported so existing imports from this file keep working.
export { ERROR_LABEL };

export const OUTCOME_LABEL: Record<Outcome, string> = {
  full: "Full marks",
  partial: "Partly right",
  stuck: "Stuck",
};
export const OUTCOME_VARIANT: Record<Outcome, "default" | "secondary" | "destructive"> = {
  full: "default",
  partial: "secondary",
  stuck: "destructive",
};
export /** "1 h 5 min", "12 min", "45 s"; "–" when no time was recorded. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "–";
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** One attempt: its working, every mark with its basis, the hints shown and the time spent. */
export function AttemptCard({ attempt, number }: { attempt: AttemptRecord; number: number }) {
  const submission = attempt.submission;
  const submitted = submission?.submittedAt != null;
  return (
    <article className="flex flex-col gap-3 rounded-lg border p-3" aria-label={`Attempt ${number}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <h3 className="font-medium">Attempt {number}</h3>
        <span className="text-muted-foreground">{dateFormat.format(attempt.startedAt)}</span>
        <span className="text-muted-foreground">
          {attempt.hintLevel === 0 ? "No hints" : `Hints shown: ${attempt.hintLevel} of 3`}
        </span>
        <span className="text-muted-foreground">Time: {formatDuration(attempt.secondsSpent)}</span>
        {attempt.current ? (
          <Badge variant={OUTCOME_VARIANT[attempt.current.outcome]}>
            {OUTCOME_LABEL[attempt.current.outcome]}
          </Badge>
        ) : (
          <Badge variant="outline">{submitted ? "Not marked yet" : "Not submitted"}</Badge>
        )}
      </header>

      {submitted ? (
        <div className="flex flex-col gap-2">
          {submission.text?.trim() ? (
            <div className="rounded-md bg-muted/50 p-2 text-sm">
              <MathText>{submission.text}</MathText>
            </div>
          ) : null}
          {submission.files.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {submission.files.map((file, index) => (
                <li key={file.id}>
                  <a
                    href={`/api/files/submission/${file.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {file.mime === "application/pdf" ? "Working PDF" : `Photo ${index + 1}`}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No working was submitted.</p>
      )}

      {attempt.marks.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {attempt.marks.map((mark) => (
            <li key={mark.id} className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={OUTCOME_VARIANT[mark.outcome]}>{OUTCOME_LABEL[mark.outcome]}</Badge>
                <span>{mark.score}/5</span>
                <Badge variant="outline">
                  {mark.basis === "official" ? "Official solution" : "AI mark"}
                  {mark.isDispute ? ", disputed" : ""}
                </Badge>
                {mark.errorType ? (
                  <span className="text-muted-foreground">{ERROR_LABEL[mark.errorType]}</span>
                ) : null}
                <span className="text-muted-foreground">{dateFormat.format(mark.createdAt)}</span>
                {attempt.current?.id === mark.id ? (
                  <span className="text-muted-foreground">(counts)</span>
                ) : null}
              </div>
              {mark.feedback ? (
                <MathText className="text-muted-foreground">{mark.feedback}</MathText>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
