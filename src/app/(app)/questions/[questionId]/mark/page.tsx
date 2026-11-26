import { redirect } from "next/navigation";

// The mark moved onto the question page (SPEC-study-views.md, mark-in-place). Old links, the
// mistakes list and revision sessions still arrive here, so keep the attempt and the session.
export default async function MarkPage({
  params,
  searchParams,
}: PageProps<"/questions/[questionId]/mark">) {
  const { questionId } = await params;
  const query = await searchParams;
  const next = new URLSearchParams();
  if (typeof query.attempt === "string" && query.attempt) next.set("attempt", query.attempt);
  if (typeof query.session === "string" && query.session) next.set("session", query.session);
  const search = next.toString();
  redirect(`/questions/${questionId}${search ? `?${search}` : ""}`);
}
