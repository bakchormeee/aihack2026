import { BatchWorking } from "@/components/batch/review";
import { PageHeader, Panel } from "@/components/page-parts";
import { getBatchQuestions } from "@/db/queries/batch-working";
import { orNotFound } from "@/lib/auth/guards";
import { requireUser } from "@/lib/auth/session";

// The matching call reads up to 10 photos and can take a while.
export const maxDuration = 300;

export default async function BatchWorkingPage({ params }: PageProps<"/sheets/[sheetId]/batch">) {
  const user = await requireUser();
  const { sheetId } = await params;
  const { ready, questions } = await orNotFound(getBatchQuestions(user.id, sheetId));
  const open = questions.filter((q) => q.canTakeWorking).length;
  const sheetHref = `/sheets/${sheetId}`;

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        back={{ href: sheetHref, label: "Back to the sheet" }}
        title="Upload working for several questions"
        description="Photograph the working for several questions and upload the photos here. The questions are matched for you; you check every match before anything is submitted."
      />
      {!ready ? (
        <Panel role="status">This sheet is not ready yet.</Panel>
      ) : open === 0 ? (
        <Panel role="status">Every question on this sheet already has submitted working.</Panel>
      ) : (
        <BatchWorking sheetId={sheetId} sheetHref={sheetHref} />
      )}
    </section>
  );
}
