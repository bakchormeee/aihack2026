import Link from "next/link";

import { cn } from "@/lib/utils";

/** The app's mark (a ruled sheet with a tick) and its name. Links home. */
export function BrandMark({
  href,
  className,
  compact = false,
}: {
  href: string;
  className?: string;
  /** Keep the name for screen readers only on a phone. */
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2.5 text-[15px] font-medium tracking-tight", className)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="text-foreground size-6 shrink-0">
        <rect x="4" y="2.5" width="16" height="19" rx="3" fill="currentColor" />
        <path
          d="M8 8h8M8 12h4"
          stroke="var(--background)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="m12.5 16 1.8 1.8 3.4-3.6"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={compact ? "max-sm:sr-only" : undefined}>Problem Sheet Companion</span>
    </Link>
  );
}
