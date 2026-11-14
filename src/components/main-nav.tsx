"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Sheets and questions belong to a course, so they keep "Courses" lit.
const LINKS = [
  { href: "/courses", label: "Courses", match: ["/courses", "/sheets", "/questions"] },
  { href: "/revise", label: "Revise", match: ["/revise"] },
];

/** The app's main sections, with the current one marked. */
export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main">
      <ul className="flex items-center gap-1">
        {LINKS.map((link) => {
          const active = link.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors",
                  "after:bg-pen after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:transition-transform after:duration-300",
                  active
                    ? "text-foreground after:scale-x-100"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
