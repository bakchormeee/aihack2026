import Link from "next/link";

import { cn } from "@/lib/utils";

/** The app's name with a red-pen tick. Links home. */
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
    <Link href={href} className={cn("flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="text-pen size-5 shrink-0">
        <path
          d="M4 13.5 9.2 19 20 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={cn(
          "font-heading text-[17px] font-semibold tracking-tight",
          compact && "max-sm:sr-only",
        )}
      >
        Problem Sheet Companion
      </span>
    </Link>
  );
}
