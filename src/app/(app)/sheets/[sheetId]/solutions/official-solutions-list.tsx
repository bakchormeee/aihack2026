import { MathText } from "@/components/math-text";
import type { OfficialSolutionRow } from "@/db/queries/official-solutions";

/**
 * Every question's official solution, each folded so that one can be opened without seeing the
 * others, and links to the uploaded files.
 */
export function OfficialSolutionsList({
  questions,
  files,
}: {
  questions: OfficialSolutionRow[];
  files: { id: string; mime: string }[];
}) {
  const found = questions.filter((q) => q.solution !== null).length;
  return (
    <section aria-labelledby="official-list-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="official-list-heading" className="text-lg font-semibold">
          Solutions by question
        </h2>
        <span className="text-muted-foreground text-xs">
          {found} of {questions.length} questions have an official solution
        </span>
      </div>
      {files.length > 0 ? (
        <p className="text-sm">
          {files.map((file, index) => (
            <a
              key={file.id}
              href={`/api/files/sheet/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="mr-4 underline underline-offset-4"
            >
              {files.length === 1
                ? "Open the uploaded solutions"
                : `Open page ${index + 1} of the uploaded solutions`}
            </a>
          ))}
        </p>
      ) : null}
      <ul className="bg-card divide-y rounded-lg border">
        {questions.map((q) => (
          <li key={q.id}>
            <details className="group px-5 py-3">
              <summary className="flex cursor-pointer items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">Question {q.label}</span>
                {q.solution === null ? (
                  <span className="text-muted-foreground text-xs">
                    Not in the uploaded solutions
                  </span>
                ) : null}
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                <MathText className="text-muted-foreground text-sm">{q.body}</MathText>
                {q.solution === null ? (
                  <p className="text-muted-foreground text-sm">
                    The uploaded solutions have nothing for this question. It keeps its AI-written
                    solution, shown on the question page once unlocked.
                  </p>
                ) : (
                  <MathText>{q.solution}</MathText>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
