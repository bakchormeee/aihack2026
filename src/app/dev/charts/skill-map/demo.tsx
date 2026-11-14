"use client";

import { SkillMap } from "@/components/charts/skill-map";

type Props = Omit<React.ComponentProps<typeof SkillMap>, "hrefForTopic">;

/** Client wrapper: a function prop cannot cross from a server page to a client component. */
export function SkillMapDemo(props: Props) {
  return (
    <SkillMap
      {...props}
      hrefForTopic={(id) => `/dev/charts/skill-map?topic=${encodeURIComponent(id)}`}
    />
  );
}
