import { SheetScoreLine } from "@/components/sheet-score-line";
import { TabNav } from "@/components/tab-nav";
import { getSheetScore } from "@/db/queries/history";
import { requireUser } from "@/lib/auth/session";

export default async function SheetLayout({ children, params }: LayoutProps<"/sheets/[sheetId]">) {
  const { sheetId } = await params;
  const user = await requireUser();
  const base = `/sheets/${sheetId}`;

  return (
    <>
      <SheetScoreLine score={await getSheetScore(user.id, sheetId)} />
      <TabNav
        label="Sheet"
        tabs={[
          { href: base, label: "Questions", exact: true },
          { href: `${base}/edit`, label: "Edit" },
          { href: `${base}/history`, label: "History" },
          { href: `${base}/summary`, label: "Summary" },
          { href: `${base}/solutions`, label: "Solutions" },
        ]}
      />
      {children}
    </>
  );
}
