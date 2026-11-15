import { startAgain } from "@/app/demo/actions";
import { Button } from "@/components/ui/button";

/** Shown on every page of a demo copy (SPEC-demo.md, section 1). */
export function DemoBanner() {
  return (
    <div className="bg-muted border-b">
      <form
        action={startAgain}
        className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-sm sm:px-6"
      >
        <p className="min-w-0">
          <span className="font-medium">Demo:</span> your changes are private and are deleted after
          24 hours.
        </p>
        <Button type="submit" variant="outline" size="sm">
          Start again
        </Button>
      </form>
    </div>
  );
}
