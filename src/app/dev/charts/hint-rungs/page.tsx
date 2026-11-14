import { notFound } from "next/navigation";

import { HintLadderBar } from "@/components/charts/hint-ladder-bar";
import { HintRungs } from "@/components/charts/hint-rungs";
import type { HintLevel } from "@/lib/domain";

export default function HintRungsDevPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl space-y-8 p-4">
      <h1 className="text-xl font-semibold">HintRungs and HintLadderBar</h1>
      <section className="space-y-3">
        <h2 className="font-medium">HintRungs</h2>
        {([0, 1, 2, 3] as HintLevel[]).map((level) => (
          <HintRungs key={level} revealed={level} />
        ))}
      </section>
      <section className="space-y-6">
        <h2 className="font-medium">HintLadderBar</h2>
        {(
          [
            ["Typical sheet", [4, 3, 2, 1]],
            ["Zero solved", [0, 0, 0, 0]],
            ["All at level 0", [10, 0, 0, 0]],
            ["Single small segment", [30, 0, 0, 1]],
            ["Large counts", [120, 85, 40, 15]],
          ] as const
        ).map(([title, counts]) => (
          <div key={title}>
            <h3 className="mb-1 text-sm text-muted-foreground">{title}</h3>
            <HintLadderBar counts={[...counts]} />
          </div>
        ))}
      </section>
    </main>
  );
}
