"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** `alsoActive`: other address prefixes on which this tab shows as selected (an old address). */
export type TabLink = { href: string; label: string; exact?: boolean; alsoActive?: string[] };

/** Whether a tab is the current one: its own address (exact or as a prefix) or an `alsoActive` prefix. */
export function isTabActive(pathname: string, tab: TabLink): boolean {
  const own = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
  return own || (tab.alsoActive ?? []).some((prefix) => pathname.startsWith(prefix));
}

/** A row of links with the current one highlighted. Scrolls sideways on a narrow screen. */
export function TabNav({ tabs, label }: { tabs: TabLink[]; label: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto border-b px-4 sm:-mx-6 sm:px-6">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
