import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Shared layout pieces for the signed-in pages, so every page reads as one
 * system: a title block over a rule, paper panels, ruled lists and quiet
 * empty states.
 */

/** The page's title block: an optional back link, the h1, a line of context and actions. */
export function PageHeader({
  back,
  title,
  description,
  actions,
  className,
}: {
  back?: { href: string; label: string };
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {back ? (
        <Link
          href={back.href}
          className="text-muted-foreground hover:text-foreground w-fit text-sm underline-offset-4 transition-colors hover:underline"
        >
          <span aria-hidden="true">← </span>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1>{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="text-muted-foreground max-w-2xl leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}

/** A sheet of paper on the desk: the one card style for grouped content. */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("bg-card rounded-lg border p-5", className)} {...props} />;
}

/** A small serif heading inside a panel or section. */
export function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-lg font-medium", className)} {...props} />;
}

/** Shown when a list has nothing in it yet. */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 rounded-lg border border-dashed px-5 py-8",
        className,
      )}
    >
      <p className="text-muted-foreground max-w-prose">{children}</p>
      {action}
    </div>
  );
}

/** A mastery or progress bar from 0 to 1, filled in red pen. */
export function Meter({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="bg-muted h-2 w-full max-w-sm overflow-hidden rounded-full"
    >
      <div
        className="bg-pen h-full origin-left rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** A list with a thin rule between rows, like the lines of a sheet. */
export function RuledList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      className={cn("bg-card divide-y overflow-hidden rounded-lg border", className)}
      {...props}
    />
  );
}

/** The link style for a whole row of a ruled list. */
export const RULED_ROW_LINK =
  "hover:bg-muted/50 relative flex flex-col gap-2 px-5 py-4 transition-colors before:bg-pen before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:transition-transform before:duration-200 hover:before:scale-y-100";
