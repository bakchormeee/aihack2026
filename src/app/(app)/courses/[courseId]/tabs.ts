import type { TabLink } from "@/components/tab-nav";

/** The course's tabs. Sheets is the course address itself; `/sheets` is the old address, kept working. */
export function courseTabs(base: string): TabLink[] {
  return [
    { href: base, label: "Sheets", exact: true, alsoActive: [`${base}/sheets`] },
    { href: `${base}/topics`, label: "Topics" },
    { href: `${base}/mistakes`, label: "Mistakes" },
    { href: `${base}/progress`, label: "Progress" },
  ];
}
