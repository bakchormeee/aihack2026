import Link from "next/link";

import { AttemptCard } from "@/components/attempt-card";
import { ExportButton } from "@/components/export-button";
import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import { getSheetHistory } from "@/db/queries/history";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { buildHandInInput } from "@/lib/export/hand-in";

import { tryAgainAction } from "./actions";

export default async function HistoryPage({ params }: PageProps<"/sheets/[sheetId]/history">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const sheet = await orNotFound(requireSheet(user.id, sheetId));
  const history = await getSheetHistory(user.id, sheetId);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{sheet.title}: history</h1>
        {history.length > 0 ? (
          <ExportButton
            title={sheet.title}
            questions={buildHandInInput(
              history.map((record) => ({
                label: record.question.label,
                attempts: record.attempts,
              })),
            )}
          />
        ) : null}
      </div>
      {history.length === 0 ? (
        <p className="text-muted-foreground text-sm">This sheet has no questions yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {history.map((record) => (
            <li key={record.question.id} className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium">Question {record.question.label}</h2>
                  {record.topics.length > 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {record.topics.map((topic) => topic.name).join(", ")}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/questions/${record.question.id}`}
                    className="text-muted-foreground self-center text-sm underline"
                  >
                    Open
                  </Link>
                  <form action={tryAgainAction.bind(null, record.question.id)}>
                    <Button type="submit" variant="outline" size="sm">
                      Try again
                    </Button>
                  </form>
                </div>
              </div>
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">Show question</summary>
                <MathText className="mt-2">{record.question.body}</MathText>
              </details>
              {record.attempts.length === 0 ? (
                <p className="text-muted-foreground text-sm">Not attempted yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {record.attempts.map((attempt, index) => (
                    <AttemptCard key={attempt.id} attempt={attempt} number={index + 1} />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
