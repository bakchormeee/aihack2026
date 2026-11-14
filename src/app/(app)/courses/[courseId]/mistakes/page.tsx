import Link from "next/link";

import { ERROR_LABEL, OUTCOME_LABEL, OUTCOME_VARIANT } from "@/components/attempt-card";
import { MathText } from "@/components/math-text";
import { Badge } from "@/components/ui/badge";
import { listMistakes } from "@/db/queries/history";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { ERROR_TYPES } from "@/lib/domain";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

function first(value: string | string[] | undefined): string | undefined {
  const one = Array.isArray(value) ? value[0] : value;
  return one ? one : undefined;
}

export default async function MistakeLogPage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/mistakes">) {
  const user = await requireUser();
  const { courseId } = await params;
  const query = await searchParams;
  const course = await orNotFound(requireCourse(user.id, courseId));

  const topicId = first(query.topic);
  const rawError = first(query.error);
  const errorType = ERROR_TYPES.find((type) => type === rawError);
  const { items, topics, errorTypes } = await listMistakes(user.id, courseId, {
    topicId,
    errorType,
  });

  const base = `/courses/${courseId}/mistakes`;
  const href = (next: { topic?: string; error?: string }) => {
    const search = new URLSearchParams();
    if (next.topic) search.set("topic", next.topic);
    if (next.error) search.set("error", next.error);
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{course.name}: mistake log</h1>

      <nav aria-label="Filter by topic" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Topic:</span>
        <FilterLink href={href({ error: errorType })} active={!topicId}>
          All
        </FilterLink>
        {topics.map((topic) => (
          <FilterLink
            key={topic.id}
            href={href({ topic: topic.id, error: errorType })}
            active={topicId === topic.id}
          >
            {topic.name}
          </FilterLink>
        ))}
      </nav>
      <nav aria-label="Filter by error type" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Error:</span>
        <FilterLink href={href({ topic: topicId })} active={!errorType}>
          All
        </FilterLink>
        {errorTypes.map((type) => (
          <FilterLink
            key={type}
            href={href({ topic: topicId, error: type })}
            active={errorType === type}
          >
            {ERROR_LABEL[type]}
          </FilterLink>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {topicId || errorType
            ? "No mistakes match this filter."
            : "No mistakes yet. Attempts that are not fully right will appear here."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.attemptId} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Link
                  href={`/questions/${item.questionId}/mark?attempt=${item.attemptId}`}
                  className="font-medium underline"
                >
                  {item.sheet ? `${item.sheet.title}, ` : "Revision question "}
                  Question {item.label}
                </Link>
                <Badge variant={OUTCOME_VARIANT[item.outcome]}>{OUTCOME_LABEL[item.outcome]}</Badge>
                {item.errorType ? (
                  <Badge variant="outline">{ERROR_LABEL[item.errorType]}</Badge>
                ) : null}
                <span className="text-muted-foreground">{dateFormat.format(item.startedAt)}</span>
              </div>
              {item.topics.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                  {item.topics.map((topic) => topic.name).join(", ")}
                </p>
              ) : null}
              {item.feedback ? <MathText className="text-sm">{item.feedback}</MathText> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1",
        active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
      )}
    >
      {children}
    </Link>
  );
}
