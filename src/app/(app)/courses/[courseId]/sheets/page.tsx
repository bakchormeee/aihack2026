import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listSheets } from "@/db/queries/sheets";
import { orNotFound } from "@/lib/auth/guards";
import { requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

import { SheetUploadForm } from "./sheet-upload-form";

const STATUS_LABEL = { parsing: "Reading the sheet…", ready: "Ready", failed: "Failed" } as const;

export default async function SheetsPage({ params }: PageProps<"/courses/[courseId]/sheets">) {
  const user = await requireUser();
  const { courseId } = await params;
  const course = await orNotFound(requireCourse(user.id, courseId));
  const sheets = await listSheets(user.id, courseId);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{course.name}: sheets</h1>
      <SheetUploadForm courseId={course.id} />
      {sheets.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sheets yet. Upload the first one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sheets.map((sheet) => (
            <li key={sheet.id}>
              <Link
                href={`/sheets/${sheet.id}`}
                className="hover:bg-muted flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <span className="font-medium">{sheet.title}</span>
                <Badge variant={sheet.status === "failed" ? "destructive" : "secondary"}>
                  {STATUS_LABEL[sheet.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
