import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { QuestionEditor } from "@/components/question-editor";
import { listCourseTopics, attemptedQuestionIds } from "@/db/queries/question-edit";
import { listQuestionsWithTopics } from "@/db/queries/sheets";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

// Hint regeneration started by an edit runs after the response and can take a while.
export const maxDuration = 300;

export default async function EditQuestionsPage({ params }: PageProps<"/sheets/[sheetId]/edit">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const sheet = await orNotFound(requireSheet(user.id, sheetId));

  if (sheet.status !== "ready") {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Edit questions</h1>
        <p className="text-muted-foreground text-sm">
          The sheet can be edited once it has been read.{" "}
          <Link href={`/sheets/${sheetId}`} className="underline">
            Back to the questions
          </Link>
        </p>
      </section>
    );
  }

  const questions = await listQuestionsWithTopics(user.id, sheetId);
  const [courseTopics, attempted] = await Promise.all([
    listCourseTopics(user.id, sheetId),
    attemptedQuestionIds(questions.map((question) => question.id)),
  ]);
  const hintsPending = questions.some((question) => question.hintsStatus === "pending");

  return (
    <section className="flex flex-col gap-4">
      <AutoRefresh active={hintsPending} />
      <div>
        <h1 className="text-xl font-semibold">Edit questions</h1>
        <p className="text-muted-foreground text-sm">
          Fix anything the reader got wrong. Once you have attempted a question, only its label and
          topics can change.
        </p>
      </div>
      {questions.length === 0 ? (
        <p className="text-muted-foreground text-sm">This sheet has no questions.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {questions.map((question, index) => (
            <li
              key={[
                question.id,
                question.label,
                question.body,
                question.topics.map((t) => t.name).join(","),
              ].join("|")}
            >
              <QuestionEditor
                question={{
                  id: question.id,
                  label: question.label,
                  body: question.body,
                  hintsStatus: question.hintsStatus,
                  topics: question.topics.map((topic) => topic.name),
                }}
                courseTopics={courseTopics.map((topic) => topic.name)}
                attempted={attempted.has(question.id)}
                nextQuestionId={questions[index + 1]?.id ?? null}
                nextAttempted={
                  questions[index + 1] ? attempted.has(questions[index + 1].id) : false
                }
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
