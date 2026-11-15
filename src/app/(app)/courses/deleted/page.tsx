import { EmptyState, PageHeader, RuledList, SectionTitle } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { listBin } from "@/db/queries/bin";
import { requireUser } from "@/lib/auth/session";

import { restoreCourseAction, restoreSheetAction } from "./actions";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

function Row({
  name,
  course,
  deletedAt,
  erasedOn,
  restore,
}: {
  name: string;
  course?: string;
  deletedAt: Date;
  erasedOn: Date;
  restore: () => Promise<void>;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="font-heading text-lg font-medium break-words">{name}</p>
        <p className="text-muted-foreground text-sm">
          {course ? `${course} · ` : ""}Deleted on {dateFormat.format(deletedAt)} · Erased on{" "}
          {dateFormat.format(erasedOn)}
        </p>
      </div>
      <form action={restore}>
        <Button type="submit" variant="outline" size="sm">
          Restore
        </Button>
      </form>
    </li>
  );
}

export default async function RecentlyDeletedPage() {
  const user = await requireUser();
  const bin = await listBin(user.id);
  const empty = bin.courses.length + bin.sheets.length === 0;

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        back={{ href: "/courses", label: "Your courses" }}
        title="Recently deleted"
        description="Deleted courses and sheets stay here for 30 days and can be restored with all their history. Then they are erased for good."
      />
      {empty ? <EmptyState>Nothing has been deleted.</EmptyState> : null}
      {bin.courses.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionTitle>Courses</SectionTitle>
          <RuledList>
            {bin.courses.map((c) => (
              <Row
                key={c.id}
                name={c.name}
                deletedAt={c.deletedAt}
                erasedOn={c.erasedOn}
                restore={restoreCourseAction.bind(null, c.id)}
              />
            ))}
          </RuledList>
        </div>
      ) : null}
      {bin.sheets.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionTitle>Sheets</SectionTitle>
          <RuledList>
            {bin.sheets.map((s) => (
              <Row
                key={s.id}
                name={s.name}
                course={s.courseName}
                deletedAt={s.deletedAt}
                erasedOn={s.erasedOn}
                restore={restoreSheetAction.bind(null, s.id)}
              />
            ))}
          </RuledList>
        </div>
      ) : null}
    </section>
  );
}
