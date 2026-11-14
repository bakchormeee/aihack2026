import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";

export type CommonError = {
  id: string;
  description: string;
  timesSeen: number;
  /** ISO time of the most recent mistake behind it. */
  lastSeen: string | null;
  /** The student's own words at that mistake. */
  example: string | null;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** The course's common errors, as the student's memory of their own mistakes. */
export function CommonErrors({
  errors,
  updating,
  hideAction,
}: {
  errors: CommonError[];
  updating: boolean;
  /** The "Not me" server action, passed in so this component has no server-only imports. */
  hideAction: (misconceptionId: string) => Promise<void>;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-6" aria-labelledby="common-errors-heading">
      <h2 id="common-errors-heading" className="text-lg font-medium">
        Your common errors
      </h2>
      {updating ? (
        <p role="status" className="text-muted-foreground text-sm">
          Updating your common errors…
        </p>
      ) : null}
      {errors.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Your common errors are built from the mistakes in your marked answers. Once you have a few
          marked, they will appear here.
        </p>
      ) : (
        <ul className="rise-children flex flex-col gap-3">
          {errors.map((error) => (
            <li
              key={error.id}
              className="bg-background/60 border-l-pen flex flex-col gap-2 rounded-lg border border-l-4 p-4"
            >
              <MathText className="text-sm">{error.description}</MathText>
              <p className="text-muted-foreground text-xs">
                <span className="text-pen font-semibold tabular-nums">×{error.timesSeen}</span> ·{" "}
                {error.timesSeen === 1 ? "Seen once" : `Seen ${error.timesSeen} times`}
                {error.lastSeen ? `, last on ${formatDate(error.lastSeen)}` : ""}
              </p>
              {error.example ? (
                <div className="text-sm">
                  <span className="text-muted-foreground text-xs">Your working: </span>
                  <MathText className="inline [&_p]:inline">{error.example}</MathText>
                </div>
              ) : null}
              <form action={hideAction.bind(null, error.id)}>
                <Button type="submit" variant="outline" size="sm">
                  Not me
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
