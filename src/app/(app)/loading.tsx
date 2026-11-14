import { Skeleton } from "@/components/ui/skeleton";

// Shown at once while a page in the signed-in area loads its data, so a click
// feels instant instead of freezing on the old page.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
