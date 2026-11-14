import { TabNav } from "@/components/tab-nav";

export default async function SheetLayout({ children, params }: LayoutProps<"/sheets/[sheetId]">) {
  const { sheetId } = await params;
  const base = `/sheets/${sheetId}`;

  return (
    <>
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
